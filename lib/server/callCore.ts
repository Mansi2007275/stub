import { z } from "zod";
import { isHex, keccak256, size, stringToBytes, type Address, type Hex, type PublicClient, type WalletClient, type Chain, type Account, type Transport } from "viem";
import { escrowAbi } from "./escrowAbi";
import { ProviderError } from "./pitchBrief";
import { keys, type Store } from "./store";
import { callMessage, canonicalJson, hashInput, INPUT_MAX, INPUT_MIN, type CallResponse } from "../../shared/protocol";

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
  /** The paid work. Any JSON-serialisable result. Throw ProviderError to trigger an instant refund. */
  generate: (input: string) => Promise<unknown>;
  /** Don't start work if fewer than this many seconds remain before the deadline. */
  safetySeconds?: number;
  now?: () => number;
};

type Out = { status: number; body: CallResponse<unknown> };
const fail = (status: number, error: string, extra: Partial<Extract<CallResponse<unknown>, { ok: false }>> = {}): Out => ({
  status,
  body: { ok: false, error, ...extra },
});

const STATUS = { None: 0, Locked: 1, Fulfilled: 2, Refunded: 3 } as const;

/**
 * The whole paid-call state machine. Order matters:
 * validate → read chain → authorize signer → return cached → lock → generate → store → fulfil.
 * A buyer is never asked to pay again: every retry with the same purchaseId converges on the same outcome.
 */
export async function processCall(deps: Deps, raw: unknown): Promise<Out> {
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
  const signerOk =
    (await client.verifyMessage({ address: p.payer, message, signature }).catch(() => false)) ||
    (p.buyer.toLowerCase() !== p.payer.toLowerCase() &&
      (await client.verifyMessage({ address: p.buyer, message, signature }).catch(() => false)));
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

  try {
    // A previous attempt may have produced a result but lost the fulfil tx. Reuse it.
    let resultJson = await store.get(keys.result(purchaseId));
    if (!resultJson) {
      let produced: unknown;
      try {
        produced = await deps.generate(input.trim());
      } catch (e) {
        // 6. Provider failed: refund immediately instead of making the buyer wait for the deadline.
        const code = e instanceof ProviderError ? e.message : "provider_failed";
        const refundTx = await wallet.writeContract({ address: escrow, abi: escrowAbi, functionName: "refundEarly", args: [purchaseId] });
        await client.waitForTransactionReceipt({ hash: refundTx });
        await store.set(keys.failed(purchaseId), code);
        return fail(502, "provider_failed", { refunded: true, refundTx, detail: code });
      }
      resultJson = canonicalJson(produced);
      await store.set(keys.result(purchaseId), resultJson); // persist BEFORE releasing funds
    }

    // 7. Release escrow with the hash of exactly what we return.
    const resultHash = keccak256(stringToBytes(resultJson));
    const fulfillTx = await wallet.writeContract({
      address: escrow,
      abi: escrowAbi,
      functionName: "fulfill",
      args: [purchaseId, resultHash],
    });
    const receipt = await client.waitForTransactionReceipt({ hash: fulfillTx });
    if (receipt.status !== "success") return fail(502, "fulfill_reverted");

    return { status: 200, body: { ok: true, purchaseId, result: JSON.parse(resultJson) as unknown, resultHash, fulfillTx, cached: false } };
  } finally {
    await store.del(keys.lock(purchaseId));
  }
}
