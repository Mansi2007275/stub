import { erc20Abi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { escrowAbi } from "./escrowAbi";
import { API_BASE, ESCROW_ADDRESS, SERVICE_ID, USDC_ADDRESS, chain } from "./config";
import { callMessage, hashInput, type CallResponse } from "../../shared/protocol";

export type Step = "quote" | "approve" | "lock" | "sign" | "generate" | "done";
export type Progress = { step: Step; tx?: Hex; purchaseId?: Hex };

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

/** quote → approve (if needed) → pay → sign → /api/call. Resumes a saved purchase instead of paying again. */
export async function payAndCall(opts: {
  input: string;
  account: Address;
  wallet: WalletClient;
  client: PublicClient;
  onProgress: (p: Progress) => void;
  resume?: Hex;
}): Promise<CallResponse> {
  const { input, account, wallet, client, onProgress } = opts;
  if (!ESCROW_ADDRESS) throw new Error("Escrow address is not configured");
  const inputHash = hashInput(input);
  let purchaseId = opts.resume;

  if (!purchaseId) {
    onProgress({ step: "quote" });
    const q = await fetch(`${API_BASE}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serviceId: SERVICE_ID.toString(), buyer: account }),
    });
    if (!q.ok) throw new Error(`Couldn't get a quote (${q.status})`);
    const quote = (await q.json()) as { purchaseId: Hex; price: string; maxAmount: string };
    purchaseId = quote.purchaseId;
    const price = BigInt(quote.price);

    const allowance = await client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "allowance", args: [account, ESCROW_ADDRESS] });
    if (allowance < price) {
      onProgress({ step: "approve", purchaseId });
      const tx = await wallet.writeContract({ account, chain, address: USDC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [ESCROW_ADDRESS, price] });
      await client.waitForTransactionReceipt({ hash: tx });
    }

    onProgress({ step: "lock", purchaseId });
    const lockTx = await wallet.writeContract({
      account,
      chain,
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "pay",
      args: [SERVICE_ID, purchaseId, inputHash, BigInt(quote.maxAmount)],
    });
    savePending({ purchaseId, input, at: Date.now() }); // from here on, never pay again for this input
    const r = await client.waitForTransactionReceipt({ hash: lockTx });
    if (r.status !== "success") throw new Error("Payment transaction failed");
    onProgress({ step: "lock", purchaseId, tx: lockTx });
  }

  onProgress({ step: "sign", purchaseId });
  const signature = await wallet.signMessage({ account, message: callMessage(purchaseId, inputHash) });

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
