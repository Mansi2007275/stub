import { erc20Abi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { escrowAbi } from "./escrowAbi";
import { API_BASE, ESCROW_ADDRESS, SERVICE_ID, USDC_ADDRESS, chain } from "./config";
import { callMessage, hashInput, type CallResponse } from "../../shared/protocol";
import { RPC_BUSY_MESSAGE, RPC_URLS, logRpcError, recentRpcCalls, withRpcRetry } from "./rpc";

export type Step = "quote" | "approve" | "lock" | "sign" | "generate" | "done";
export type Progress = { step: Step; tx?: Hex; purchaseId?: Hex };


/**
 * Set while a purchase is mid-flight. Background feed polling stands down for the duration so it
 * cannot spend the RPC's rate-limit budget during someone's payment.
 */
let paying = 0;
export const isPaymentInProgress = () => paying > 0;

const PENDING_KEY = "stub:pending";
type Pending = { purchaseId: Hex; input: string; at: number };

const savePending = (p: Pending | null) => {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage blocked */
  }
};
export const loadPending = (): Pending | null => {
  try {
    const v = localStorage.getItem(PENDING_KEY);
    return v ? (JSON.parse(v) as Pending) : null;
  } catch {
    return null;
  }
};

async function postCall(body: { purchaseId: Hex; input: string; signature: Hex }): Promise<CallResponse> {
  // Bounded retries with the SAME purchaseId: a lost response never leads to a second payment.
  let last: CallResponse = { ok: false, error: "network_error" };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${API_BASE}/call`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      last = (await r.json()) as CallResponse;
      if (r.status !== 409 || last.ok || last.error !== "in_progress") return last;
    } catch {
      last = { ok: false, error: "network_error" };
    }
    await new Promise((res) => setTimeout(res, 2500 * (attempt + 1)));
  }
  return last;
}


/**
 * Arc's RPCs leave eth_getTransactionReceipt null for minutes after the block is produced, so
 * viem's waitForTransactionReceipt rejects on transactions that already succeeded. Returns
 * "unknown" instead of throwing on that lag; callers settle it against the escrow itself.
 */
async function waitMined(client: PublicClient, hash: Hex, budgetMs = 90_000): Promise<"success" | "reverted" | "unknown"> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    try {
      return (await client.getTransactionReceipt({ hash })).status;
    } catch {
      // not indexed yet (or the node is throttling) - retry until the budget runs out
    }
    if (Date.now() >= deadline) return "unknown";
    await new Promise((r) => setTimeout(r, 2_500));
  }
}

/** The contract is the source of truth for "did my payment land". Status 1 = Locked. */
async function isLocked(client: PublicClient, escrow: Address, purchaseId: Hex): Promise<boolean> {
  try {
    const status = await withRpcRetry(() => client.readContract({ address: escrow, abi: escrowAbi, functionName: "statusOf", args: [purchaseId] }));
    return Number(status) === 1;
  } catch {
    return false;
  }
}

/**
 * A write goes out through the wallet's own transport, so it is throttled by whatever RPC URL the
 * wallet has for this chain - not by RPC_URLS. Retrying on our side cannot help, and telling the
 * buyer "the network is busy" sends them nowhere, so this names the wallet and what to change.
 */
export class WalletRpcBusyError extends Error {
  constructor(what: string) {
    super(
      `Your wallet's own Arc RPC rate-limited it, so the ${what} request never opened. ` +
        `Change the Arc Testnet RPC URL in your wallet to ${RPC_URLS[0]}, then try again. You have not been charged.`,
    );
    this.name = "WalletRpcBusyError";
  }
}

/**
 * Runs one labelled step. On failure it names the exact call that broke, logs the raw error with
 * its method / JSON-RPC code / HTTP status, and dumps the tab's last 60 s of RPC traffic - so a
 * friendly message in the UI can never be the only record of what happened.
 */
async function step<T>(label: string, fn: () => Promise<T>, via: "wallet" | "rpc" = "rpc", what = label): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const facts = logRpcError(label, e);
    console.error(`[pay] first failing call: ${label} (via ${via})`);
    console.table(recentRpcCalls(60));
    if (facts.busy && via === "wallet") throw new WalletRpcBusyError(what);
    throw e;
  }
}

/** quote → approve (if needed) → pay → sign → /api/call. Resumes a saved purchase instead of paying again. */
export async function payAndCall(opts: {
  input: string;
  account: Address;
  wallet: WalletClient;
  client: PublicClient;
  onProgress: (p: Progress) => void;
  resume?: Hex;
}): Promise<CallResponse> {
  if (!ESCROW_ADDRESS) throw new Error("Escrow address is not configured");
  paying++;
  try {
    return await runPayAndCall(opts, ESCROW_ADDRESS);
  } finally {
    paying--;
  }
}

async function runPayAndCall(
  opts: Parameters<typeof payAndCall>[0],
  ESCROW_ADDRESS: Address,
): Promise<CallResponse> {
  const { input, account, wallet, client, onProgress } = opts;
  const inputHash = hashInput(input);
  let purchaseId = opts.resume;

  if (!purchaseId) {
    onProgress({ step: "quote" });
    const q = await fetch(`${API_BASE}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serviceId: SERVICE_ID.toString(), buyer: account }),
    });
    if (!q.ok) {
      const detail = await q.text().catch(() => "");
      console.error(`[pay] POST ${API_BASE}/quote -> HTTP ${q.status}`, detail);
      // 429 here is the gateway's own rate limiter; anything else keeps its real status.
      throw new Error(q.status === 429 ? RPC_BUSY_MESSAGE : `Couldn't get a quote (HTTP ${q.status}${detail ? `: ${detail.slice(0, 200)}` : ""})`);
    }
    const quote = (await q.json()) as { purchaseId: Hex; price: string; maxAmount: string };
    purchaseId = quote.purchaseId;
    const price = BigInt(quote.price);

    // Throttling here used to abort the purchase before Approve ever opened, so it retries.
    const allowance = await withRpcRetry(
      () => client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "allowance", args: [account, ESCROW_ADDRESS] }),
      5,
      500,
      `allowance(${account}, ${ESCROW_ADDRESS}) via publicClient`,
    );
    if (allowance < price) {
      onProgress({ step: "approve", purchaseId });
      // Exactly one call's worth of allowance - never an infinite approve.
      const tx = await step(
        "approve(spender=escrow) via wallet",
        () => wallet.writeContract({ account, chain, address: USDC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [ESCROW_ADDRESS, price] }),
        "wallet",
        "approval",
      );
      if ((await waitMined(client, tx)) === "reverted") throw new Error("The approval transaction failed. You have not been charged.");
    }

    onProgress({ step: "lock", purchaseId });
    const lockTx = await step(
      "pay(serviceId, purchaseId, inputHash, maxAmount) via wallet",
      () =>
        wallet.writeContract({
          account,
          chain,
          address: ESCROW_ADDRESS,
          abi: escrowAbi,
          functionName: "pay",
          args: [SERVICE_ID, purchaseId!, inputHash, BigInt(quote.maxAmount)],
        }),
      "wallet",
      "payment",
    );
    savePending({ purchaseId, input, at: Date.now() }); // from here on, never pay again for this input
    const mined = await waitMined(client, lockTx);
    if (mined === "reverted") throw new Error("Payment transaction failed. You have not been charged.");
    // "unknown" only means the receipt is not indexed yet: ask the escrow whether the lock landed.
    if (mined === "unknown" && !(await isLocked(client, ESCROW_ADDRESS, purchaseId))) {
      throw new Error("Couldn't confirm your payment yet. Reload this page in a minute - your purchase resumes without paying again.");
    }
    onProgress({ step: "lock", purchaseId, tx: lockTx });
  }

  onProgress({ step: "sign", purchaseId });
  const signature = await step(
    "personal_sign(callMessage) via wallet",
    () => wallet.signMessage({ account, message: callMessage(purchaseId!, inputHash) }),
    "wallet",
    "signature",
  );

  onProgress({ step: "generate", purchaseId });
  const out = await postCall({ purchaseId, input, signature });
  if (out.ok || out.refunded) savePending(null);
  if (out.ok) onProgress({ step: "done", purchaseId, tx: out.fulfillTx });
  return out;
}

export const ERRORS: Record<string, string> = {
  not_paid: "No payment found for this purchase.",
  bad_signature: "The signature doesn't match the wallet that paid.",
  input_mismatch: "The idea text changed after payment. Use exactly the text you paid for.",
  provider_failed: "The generator failed. Your USDC has been refunded.",
  refunded: "This purchase was refunded.",
  deadline_too_close: "The delivery window is almost over. Wait for the deadline, then refund from the receipt page.",
  in_progress: "Still generating. Check the receipt page in a minute.",
  rate_limited: "Too many requests. Try again in a minute.",
  not_configured: "The gateway isn't configured yet.",
  network_error: "Couldn't reach the gateway. Your payment is safe; retry without paying again.",
};

/**
 * Only genuine throttling (JSON-RPC -32005 / HTTP 429) becomes the friendly busy message. Every
 * other failure shows its real text, because a wrong friendly message hides the actual bug.
 */
export function humanError(e: unknown): string {
  const facts = logRpcError("surfaced to buyer", e);
  if (facts.busy) return RPC_BUSY_MESSAGE;
  const err = e as { shortMessage?: string; message?: string; code?: number };
  // 4001 / "User rejected" is a wallet answer, not a failure.
  if (err.code === 4001 || /user rejected|user denied/i.test(`${err.shortMessage ?? ""} ${err.message ?? ""}`)) {
    return "You cancelled in your wallet. Nothing was charged unless the lock step finished.";
  }
  const msg = err.shortMessage || err.message || String(e);
  return facts.code !== undefined || facts.status !== undefined ? `${msg} (code ${facts.code ?? facts.status})` : msg;
}
