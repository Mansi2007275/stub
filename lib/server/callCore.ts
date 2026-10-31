import { z } from "zod";
import { isHex, keccak256, size, stringToBytes, type Address, type Hex, type PublicClient, type WalletClient, type Chain, type Account, type Transport } from "viem";
import { escrowAbi } from "./escrowAbi.js";
import { ProviderError } from "./pitchBrief.js";
import { keys, type Store } from "./store.js";
import { callMessage, canonicalJson, hashInput, INPUT_MAX, INPUT_MIN, type CallResponse } from "../../shared/protocol.js";

export const CallBody = z.object({
  purchaseId: z.string().refine((v) => isHex(v) && size(v as Hex) === 32, "purchaseId must be bytes32"),
  input: z.string().min(INPUT_MIN).max(INPUT_MAX),
  signature: z.string().refine((v) => isHex(v), "signature must be hex"),
});

export type Deps = {
  client: PublicClient;
  wallet: WalletClient<Transport, Chain, Account>; // fulfiller key
  escrow: Address;
  serviceId: bigint;
  store: Store;
  /**
   * The paid work. Any JSON-serialisable result. Throw ProviderError to trigger an instant refund.
   * `opts.timeoutMs` is how much of the request budget is left for it; a generator that honours it
   * fails with its own precise code instead of being cut off by the hard deadline below.
   */
  generate: (input: string, opts?: { timeoutMs?: number }) => Promise<unknown>;
  /** Don't start work if fewer than this many seconds remain before the deadline. */
  safetySeconds?: number;
  /** Wall-clock budget for the whole request. Must stay inside the platform's function limit. */
  requestBudgetMs?: number;
  /** Held back from generation so the settlement tx and its confirmation always fit in the budget. */
  settlementReserveMs?: number;
  /** Hard cap on one settlement confirmation poll, even when more budget is left. */
  confirmBudgetMs?: number;
  now?: () => number;
};

type Out = { status: number; body: CallResponse<unknown> };
const fail = (status: number, error: string, extra: Partial<Extract<CallResponse<unknown>, { ok: false }>> = {}): Out => ({
  status,
  body: { ok: false, error, ...extra },
});

const STATUS = { None: 0, Locked: 1, Fulfilled: 2, Refunded: 3 } as const;

/**
 * /api/call has a 60s function limit. 45s of generation plus a 25s fulfil confirmation could exceed
 * it, and a killed function leaves money moved with no answer for the buyer. So the whole request
 * runs against one wall-clock budget: generation gets what is left minus a reserve, and the reserve
 * is what pays for sending the settlement tx and confirming it on-chain.
 */
const REQUEST_BUDGET_MS = 55_000; // the 60s limit minus platform overhead and the response itself
const SETTLEMENT_RESERVE_MS = 18_000;
const CONFIRM_BUDGET_MS = 25_000;
const SEND_BUDGET_MS = 12_000; // bound on writeContract (sign + broadcast) alone
const CONFIRM_TAIL_MS = 1_500; // left for serialising the response
const MIN_GENERATE_MS = 3_000;
const POLL_MS = 2_000;

/** Thrown when a bounded wait elapsed. The underlying operation's outcome is UNKNOWN, not failed. */
class DeadlineError extends Error {}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new DeadlineError()), Math.max(0, ms));
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

type Settlement = "confirmed" | "reverted" | "pending";

/**
 * Arc's RPCs index eth_getTransactionReceipt minutes after the block is produced, so viem's
 * waitForTransactionReceipt times out on a transaction that already succeeded - which turned a
 * released escrow into a 500 for the buyer. The escrow's own status is authoritative and cheap, so
 * it gets the last word; the receipt is only a faster path to the same answer. When neither has an
 * answer inside the budget the result is "pending": the transaction may still land, so it is never
 * reported as failed, and a refund is never reported as completed.
 */
async function confirmSettlement(
  client: PublicClient,
  escrow: Address,
  purchaseId: Hex,
  hash: Hex,
  want: (typeof STATUS)[keyof typeof STATUS],
  budgetMs: number,
): Promise<Settlement> {
  const deadline = Date.now() + Math.max(0, budgetMs);
  const bounded = <T>(p: Promise<T>) => withDeadline(p, Math.max(0, deadline - Date.now()));
  const settled = async () => {
    try {
      return Number(await bounded(client.readContract({ address: escrow, abi: escrowAbi, functionName: "statusOf", args: [purchaseId] }))) === want;
    } catch {
      return false; // RPC hiccup: say nothing rather than something wrong
    }
  };
  for (;;) {
    if (Date.now() >= deadline) return "pending";
    if (await settled()) return "confirmed";
    if (Date.now() >= deadline) return "pending";
    try {
      const receipt = await bounded(client.getTransactionReceipt({ hash }));
      if (receipt.status === "success") return "confirmed";
      // Mined and reverted. The escrow state just read is the one that matters.
      return (await settled()) ? "confirmed" : "reverted";
    } catch {
      /* receipt not indexed yet */
    }
    if (Date.now() >= deadline) return "pending";
    await new Promise((r) => setTimeout(r, Math.min(POLL_MS, Math.max(100, deadline - Date.now()))));
  }
}

/**
 * The whole paid-call state machine. Order matters:
 * validate -> read chain -> authorize signer -> return cached -> lock -> generate -> store -> settle.
 * A buyer is never asked to pay again: every retry with the same purchaseId converges on the same
 * outcome, and an unconfirmed settlement is reported as pending so the retry can finish it.
 */
export async function processCall(deps: Deps, raw: unknown): Promise<Out> {
  const startedAt = Date.now();
  const remaining = () => Math.max(0, (deps.requestBudgetMs ?? REQUEST_BUDGET_MS) - (Date.now() - startedAt) - CONFIRM_TAIL_MS);
  // A slow RPC/Redis operation must not defeat the wall-clock budget. Timed-out reads never
  // resume the worker; it exits without starting any subsequent provider or wallet operation.
  const bound = <T extends object>(target: T): T => new Proxy(target, {
    get(object, property, receiver) {
      const value: unknown = Reflect.get(object, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (remaining() <= 0) return Promise.reject(new DeadlineError());
        return withDeadline(Promise.resolve(Reflect.apply(value, object, args)), remaining());
      };
    },
  });
  try {
    return await processCallBudgeted({ ...deps, client: bound(deps.client), store: bound(deps.store) }, raw, startedAt);
  } catch (error) {
    if (error instanceof DeadlineError) return fail(503, "no_time_left");
    throw error;
  }
}

async function processCallBudgeted(deps: Deps, raw: unknown, startedAt: number): Promise<Out> {
  const budgetMs = deps.requestBudgetMs ?? REQUEST_BUDGET_MS;
  const msLeft = () => budgetMs - (Date.now() - startedAt);

  const parsed = CallBody.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid_body");
  const purchaseId = parsed.data.purchaseId as Hex;
  const input = parsed.data.input;
  const signature = parsed.data.signature as Hex;
  const { client, wallet, escrow, store } = deps;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  // 1. On-chain purchase is the source of truth.
  const p = await client.readContract({ address: escrow, abi: escrowAbi, functionName: "getPurchase", args: [purchaseId] });
  if (p.status === STATUS.None) return fail(402, "not_paid");
  if (p.serviceId !== deps.serviceId) return fail(403, "wrong_service");
  if (p.fulfiller.toLowerCase() !== wallet.account.address.toLowerCase()) return fail(403, "wrong_gateway");

  // 2. Input must be exactly what was committed at pay() time.
  const inputHash = hashInput(input);
  if (inputHash !== p.inputHash) return fail(403, "input_mismatch");

  // 3. Only the payer or their agent may collect the result. Supports EOAs and smart wallets (ERC-1271/6492).
  const message = callMessage(purchaseId, inputHash);
  const signatureFailure = (error: unknown) => {
    if (error instanceof DeadlineError) throw error;
    return false;
  };
  const signerOk =
    (await client.verifyMessage({ address: p.payer, message, signature }).catch(signatureFailure)) ||
    (p.buyer.toLowerCase() !== p.payer.toLowerCase() &&
      (await client.verifyMessage({ address: p.buyer, message, signature }).catch(signatureFailure)));
  if (!signerOk) return fail(401, "bad_signature");

  // 4. Already settled? Return the stored result. Never re-run, never re-charge.
  if (p.status === STATUS.Refunded) return fail(409, "refunded", { refunded: true });
  if (p.status === STATUS.Fulfilled) {
    const cached = await store.get(keys.result(purchaseId));
    if (!cached) return fail(500, "result_missing");
    return { status: 200, body: { ok: true, purchaseId, result: JSON.parse(cached) as unknown, resultHash: p.resultHash, cached: true } };
  }

  // Locked from here on.
  if (Number(p.deadline) - now() < (deps.safetySeconds ?? 30)) return fail(410, "deadline_too_close");

  // 5. One worker per purchase. A concurrent duplicate gets 409 and can poll /api/purchase/:id.
  const gotLock = await store.set(keys.lock(purchaseId), "1", { nx: true, ex: 120 });
  if (!gotLock) return fail(409, "in_progress");

  const reserveMs = deps.settlementReserveMs ?? SETTLEMENT_RESERVE_MS;
  const confirmCapMs = deps.confirmBudgetMs ?? CONFIRM_BUDGET_MS;
  const sendBudget = () => Math.max(1_000, Math.min(SEND_BUDGET_MS, msLeft() - CONFIRM_TAIL_MS));
  const confirmBudget = () => Math.min(confirmCapMs, Math.max(0, msLeft() - CONFIRM_TAIL_MS));

  // Persist intent BEFORE broadcast. A timed-out send can still land, so a retry only inspects
  // its state/hash; it must never blindly send a second transaction, even when no hash arrived.
  const sendSettlement = async (kind: "fulfill" | "refund", resultHash?: Hex): Promise<Hex | undefined> => {
    if (msLeft() <= CONFIRM_TAIL_MS) throw new DeadlineError();
    await store.set(keys.settlement(purchaseId), JSON.stringify({ kind }));
    const hash = await withDeadline(
      kind === "refund"
        ? wallet.writeContract({ address: escrow, abi: escrowAbi, functionName: "refundEarly", args: [purchaseId] })
        : wallet.writeContract({ address: escrow, abi: escrowAbi, functionName: "fulfill", args: [purchaseId, resultHash!] }),
      sendBudget(),
    ).catch(() => undefined); // Any transport error can hide an accepted broadcast.
    if (hash) await store.set(keys.settlement(purchaseId), JSON.stringify({ kind, hash }));
    return hash;
  };

  try {
    const previous = await store.get(keys.settlement(purchaseId));
    if (previous) {
      const { kind, hash } = JSON.parse(previous) as { kind: "fulfill" | "refund"; hash?: Hex };
      const settled = hash ? await confirmSettlement(client, escrow, purchaseId, hash, kind === "refund" ? STATUS.Refunded : STATUS.Fulfilled, confirmBudget()) : "pending";
      if (settled === "reverted") return fail(502, `${kind}_reverted`);
      if (settled === "confirmed") {
        if (kind === "refund") return fail(409, "refunded", { refunded: true, refundTx: hash });
        const cached = await store.get(keys.result(purchaseId));
        if (!cached) return fail(500, "result_missing");
        return { status: 200, body: { ok: true, purchaseId, result: JSON.parse(cached) as unknown, resultHash: keccak256(stringToBytes(cached)), fulfillTx: hash, cached: true } };
      }
      return fail(202, `${kind}_pending`, { pending: true, ...(kind === "refund" ? { refundTx: hash } : { fulfillTx: hash }) });
    }
    // A previous attempt may have produced a result but lost the fulfil tx. Reuse it.
    let resultJson = await store.get(keys.result(purchaseId));
    if (!resultJson) {
      // 6. Generation gets everything except the settlement reserve, so fulfil or refund always fits.
      const genBudget = msLeft() - reserveMs;
      if (genBudget < MIN_GENERATE_MS) return fail(503, "no_time_left");

      let produced: unknown;
      try {
        const failed = await store.get(keys.failed(purchaseId));
        if (failed) throw new ProviderError(failed);
        // The hint lets the generator abort itself first; the hard deadline is the backstop.
        produced = await withDeadline(deps.generate(input.trim(), { timeoutMs: Math.max(1_000, genBudget - 500) }), genBudget);
      } catch (e) {
        // 7. Provider failed (or ran past its budget): refund now instead of making the buyer wait
        //    for the deadline. The refund is confirmed the same lag-tolerant way as a fulfil, and
        //    an unconfirmed refund is reported as pending - never as a completed refund.
        const code = e instanceof ProviderError ? e.message : e instanceof DeadlineError ? "provider_timeout" : "provider_failed";
        await store.set(keys.failed(purchaseId), code);
        let refundTx: Hex | undefined;
        try {
          refundTx = await sendSettlement("refund");
        } catch (sendErr) {
          // Broadcast outcome unknown: it may still land. Say pending - not refunded, not failed.
          if (sendErr instanceof DeadlineError) return fail(202, "refund_pending", { pending: true, detail: code });
          throw sendErr;
        }
        if (!refundTx) return fail(202, "refund_pending", { pending: true, detail: code });
        const settled = await confirmSettlement(client, escrow, purchaseId, refundTx, STATUS.Refunded, confirmBudget());
        if (settled === "confirmed") return fail(502, "provider_failed", { refunded: true, refundTx, detail: code });
        if (settled === "reverted") return fail(502, "refund_reverted", { refundTx, detail: code });
        return fail(202, "refund_pending", { pending: true, refundTx, detail: code });
      }
      resultJson = canonicalJson(produced);
      await store.set(keys.result(purchaseId), resultJson); // persist BEFORE releasing funds
    }

    // 8. Release escrow with the hash of exactly what we return.
    const resultHash = keccak256(stringToBytes(resultJson));
    let fulfillTx: Hex | undefined;
    try {
      fulfillTx = await sendSettlement("fulfill", resultHash);
    } catch (sendErr) {
      // The saved intent keeps a retry inspecting this attempt without re-running the provider.
      if (sendErr instanceof DeadlineError) return fail(202, "fulfill_pending", { pending: true, resultHash });
      throw sendErr;
    }
    if (!fulfillTx) return fail(202, "fulfill_pending", { pending: true, resultHash });
    const settled = await confirmSettlement(client, escrow, purchaseId, fulfillTx, STATUS.Fulfilled, confirmBudget());
    if (settled === "reverted") return fail(502, "fulfill_reverted", { fulfillTx });
    // Not confirmed inside the budget: the release may still land, so the buyer is told to retry
    // (which returns the cached result once the escrow says Fulfilled) rather than that it failed.
    if (settled === "pending") return fail(202, "fulfill_pending", { pending: true, fulfillTx, resultHash });

    return { status: 200, body: { ok: true, purchaseId, result: JSON.parse(resultJson) as unknown, resultHash, fulfillTx, cached: false } };
  } finally {
    await store.del(keys.lock(purchaseId)).catch(() => {}); // TTL recovers a lock if Redis is unavailable.
  }
}
