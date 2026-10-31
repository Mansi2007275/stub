// Shared between the browser app and the API. Keep it dependency-light.
import { keccak256, stringToBytes, type Hex } from "viem";

/** Hash committed on-chain at pay() time. The gateway recomputes it from the submitted input. */
export const hashInput = (input: string): Hex => keccak256(stringToBytes(input.trim()));

/** Message the payer (or their agent) signs to prove they own the purchase. EIP-191 personal_sign. */
export const callMessage = (purchaseId: Hex, inputHash: Hex) =>
  `Stub call authorization\npurchase: ${purchaseId}\ninput: ${inputHash}`;

export const INPUT_MIN = 20;
export const INPUT_MAX = 4000;

export type PitchBrief = {
  title: string;
  oneLiner: string;
  problem: string;
  customer: string;
  solution: string;
  market: string;
  businessModel: string;
  moat: string;
  risks: string[];
  slides: { title: string; bullets: string[] }[];
};

export type CallResponse<T = PitchBrief> =
  | { ok: true; purchaseId: Hex; result: T; resultHash: Hex; fulfillTx?: Hex; cached: boolean }
  /**
   * `pending: true` means a settlement transaction's outcome is not yet known (Arc can leave a
   * receipt unindexed for minutes). It is NOT a failure and NOT a completed refund: retry the same
   * purchaseId, or read GET /api/purchase/:id. `refunded: true` is only ever set once the escrow
   * itself reports Refunded.
   */
  | { ok: false; error: string; refunded?: boolean; refundTx?: Hex; fulfillTx?: Hex; resultHash?: Hex; pending?: boolean; detail?: string };

/** Deterministic JSON (sorted object keys) so anyone holding a result can recompute its on-chain hash. */
export const canonicalJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );

/** The value the gateway posts in fulfill(): keccak256 of the canonical JSON it returned. */
export const resultHashOf = (result: unknown): Hex => keccak256(stringToBytes(canonicalJson(result)));
