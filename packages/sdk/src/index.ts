/**
 * @stub/sdk — buy a Stub service from any TypeScript app or agent.
 *
 *   const stub = new StubClient({ apiBase, escrow, publicClient, walletClient });
 *   const out = await stub.buy({ serviceId: 1n, input: "my idea…" });
 *
 * Guarantees:
 *  - A purchase is paid at most once. The purchaseId is persisted BEFORE the pay tx is sent,
 *    so a crash or lost response resumes the same purchase instead of paying again.
 *  - The price is bounded: pay() carries maxAmount, and an optional maxPrice rejects quotes above it.
 *  - Agents spend from an owner's budget (payAsAgent); the contract enforces per-call and daily caps.
 */
import { erc20Abi, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient } from "viem";
import { escrowAbi } from "../../../shared/escrowAbi";
import { callMessage, hashInput, type CallResponse, type PitchBrief } from "../../../shared/protocol";

export { hashInput, callMessage };
export type { CallResponse, PitchBrief };

/** Where in-flight purchases are remembered. Default is in-memory; use fileStore() in Node for crash safety. */
export interface PendingStore {
  get(key: string): Promise<Pending | null>;
  set(key: string, value: Pending): Promise<void>;
  delete(key: string): Promise<void>;
}
export type Pending = { purchaseId: Hex; serviceId: string; inputHash: Hex; lockTx?: Hex; createdAt: number };

export function memoryPending(): PendingStore {
  const m = new Map<string, Pending>();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) };
}

export type Purchase = {
  payer: Address;
  amount: bigint;
  buyer: Address;
  deadline: bigint;
  feeBps: number;
  status: number;
  merchant: Address;
  fulfiller: Address;
  serviceId: bigint;
  inputHash: Hex;
  resultHash: Hex;
};

export type BuyResult<T = PitchBrief> = {
  purchaseId: Hex;
  result: T;
  resultHash: Hex;
  lockTx?: Hex;
  fulfillTx?: Hex;
  resumed: boolean;
  cached: boolean;
};

export class StubError extends Error {
  constructor(
    public code: string,
    public purchaseId?: Hex,
    public detail?: unknown,
  ) {
    super(code);
  }
}

export type StubClientOptions = {
  apiBase: string; // e.g. https://stub.vercel.app/api
  escrow: Address;
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, Account>;
  usdc?: Address; // Arc USDC ERC-20 (6 decimals)
  pending?: PendingStore;
  fetch?: typeof fetch;
  /** When set, pay as an agent spending this owner's budget instead of from the wallet itself. */
  agentOf?: Address;
  retries?: number;
};

const ARC_USDC = "0x3600000000000000000000000000000000000000" as Address;


/**
 * Arc's RPCs index eth_getTransactionReceipt minutes after the block is produced, while
 * eth_getTransactionByHash already reports the block, so viem's waitForTransactionReceipt rejects
 * on transactions that in fact succeeded. This resolves from whichever source answers first and
 * returns "unknown" instead of throwing on lag; callers settle it against the escrow, which is the
 * real source of truth.
 */
async function waitMined(publicClient: PublicClient, hash: Hex, budgetMs = 90_000): Promise<"success" | "reverted" | "unknown"> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    try {
      return (await publicClient.getTransactionReceipt({ hash })).status;
    } catch {
      // receipt not indexed yet - fall through and retry until the budget runs out
    }
    if (Date.now() >= deadline) return "unknown";
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

export class StubClient {
  private o: Required<Omit<StubClientOptions, "agentOf">> & { agentOf?: Address };

  constructor(opts: StubClientOptions) {
    const given = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) as StubClientOptions;
    this.o = {
      usdc: ARC_USDC,
      pending: memoryPending(),
      fetch: globalThis.fetch.bind(globalThis),
      retries: 3,
      ...given,
    };
  }

  get account(): Address {
    return this.o.walletClient.account.address;
  }

  private key(serviceId: bigint, inputHash: Hex) {
    return `${this.account.toLowerCase()}:${serviceId}:${inputHash}`;
  }

  /** Read a purchase straight from the escrow. */
  async getPurchase(purchaseId: Hex): Promise<Purchase> {
    return (await this.o.publicClient.readContract({
      address: this.o.escrow,
      abi: escrowAbi,
      functionName: "getPurchase",
      args: [purchaseId],
    })) as Purchase;
  }

  async quote(serviceId: bigint): Promise<{ purchaseId: Hex; price: bigint; maxAmount: bigint; timeoutSeconds: number }> {
    const r = await this.o.fetch(`${this.o.apiBase}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serviceId: serviceId.toString(), buyer: this.account }),
    });
    const body = (await r.json()) as { purchaseId: Hex; price: string; maxAmount: string; timeoutSeconds: number; error?: string };
    if (!r.ok) throw new StubError(body.error ?? `quote_http_${r.status}`);
    return { purchaseId: body.purchaseId, price: BigInt(body.price), maxAmount: BigInt(body.maxAmount), timeoutSeconds: body.timeoutSeconds };
  }

  /** Approve the escrow for at least `amount` from the paying wallet. No-op if allowance already covers it. */
  async ensureAllowance(amount: bigint): Promise<Hex | undefined> {
    const { publicClient, walletClient, usdc, escrow } = this.o;
    const current = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "allowance", args: [this.account, escrow] });
    if (current >= amount) return undefined;
    const tx = await walletClient.writeContract({ address: usdc, abi: erc20Abi, functionName: "approve", args: [escrow, amount] });
    if ((await waitMined(publicClient, tx)) === "reverted") throw new StubError("approve_reverted");
    return tx;
  }

  /**
   * Full purchase: quote → (approve) → pay → sign → call. Safe to call again with the same input:
   * an unfinished purchase is resumed, a finished one returns the stored result without paying.
   */
  async buy<T = PitchBrief>(args: { serviceId: bigint; input: string; maxPrice?: bigint }): Promise<BuyResult<T>> {
    const { publicClient, walletClient, escrow, pending } = this.o;
    const inputHash = hashInput(args.input);
    const k = this.key(args.serviceId, inputHash);
    let p = await pending.get(k);
    let resumed = false;

    if (p) {
      // Reconcile before anything else: did the previous attempt actually lock funds?
      const onchain = await this.getPurchase(p.purchaseId);
      if (onchain.status === 3) {
        await pending.delete(k);
        throw new StubError("refunded", p.purchaseId);
      }
      if (onchain.status !== 0) resumed = true;
      // status 0: the lock never landed (or is still in flight). We re-send pay() with the SAME purchaseId below.
      // purchaseIds are single-use on-chain, so if the earlier tx lands too, one of them reverts: never a double charge.
    }

    if (!p || !resumed) {
      let purchaseId: Hex;
      let maxAmount: bigint;
      if (p) {
        purchaseId = p.purchaseId;
        const [, , price] = await publicClient.readContract({ address: escrow, abi: escrowAbi, functionName: "services", args: [args.serviceId] });
        if (args.maxPrice !== undefined && price > args.maxPrice) throw new StubError("price_above_max", undefined, { price });
        maxAmount = price;
      } else {
        const q = await this.quote(args.serviceId);
        if (args.maxPrice !== undefined && q.price > args.maxPrice) throw new StubError("price_above_max", undefined, { price: q.price });
        purchaseId = q.purchaseId;
        maxAmount = q.maxAmount;
        p = { purchaseId, serviceId: args.serviceId.toString(), inputHash, createdAt: Date.now() };
        await pending.set(k, p); // persisted BEFORE sending: a crash after this point resumes with the same id
      }
      if (!this.o.agentOf) await this.ensureAllowance(maxAmount);

      let lockTx: Hex;
      try {
        lockTx = this.o.agentOf
          ? await walletClient.writeContract({
              address: escrow,
              abi: escrowAbi,
              functionName: "payAsAgent",
              args: [this.o.agentOf, args.serviceId, purchaseId, inputHash, maxAmount],
            })
          : await walletClient.writeContract({
              address: escrow,
              abi: escrowAbi,
              functionName: "pay",
              args: [args.serviceId, purchaseId, inputHash, maxAmount],
            });
      } catch (e) {
        // Simulation reverted. If the id is already locked (earlier tx landed), resume instead of failing.
        if ((await this.getPurchase(purchaseId)).status === 1) lockTx = p.lockTx ?? ("0x" as Hex);
        else throw new StubError(revertName(e) ?? "lock_failed", purchaseId, (e as { shortMessage?: string }).shortMessage ?? String(e));
      }
      if (lockTx !== "0x") {
        p.lockTx = lockTx;
        await pending.set(k, p);
        const mined = await waitMined(publicClient, lockTx);
        if (mined !== "success" && (await this.getPurchase(purchaseId)).status !== 1) {
          throw new StubError("lock_reverted", purchaseId); // keep pending: the same id is retried next time
        }
      }
    }

    const out = await this.collect<T>(p.purchaseId, args.input);
    await pending.delete(k);
    return { ...out, lockTx: p.lockTx, resumed };
  }

  /** Ask the gateway for the result of an already-paid purchase. Retries never pay. */
  async collect<T = PitchBrief>(purchaseId: Hex, input: string): Promise<Omit<BuyResult<T>, "lockTx" | "resumed">> {
    const signature = await this.o.walletClient.signMessage({ message: callMessage(purchaseId, hashInput(input)) });
    let last: CallResponse<T> = { ok: false, error: "network_error" };
    for (let i = 0; i < this.o.retries; i++) {
      try {
        const r = await this.o.fetch(`${this.o.apiBase}/call`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purchaseId, input, signature }),
        });
        last = (await r.json()) as CallResponse<T>;
        if (last.ok) return { purchaseId, result: last.result, resultHash: last.resultHash, fulfillTx: last.fulfillTx, cached: last.cached };
        if (last.error !== "in_progress" && last.error !== "network_error") break;
      } catch {
        last = { ok: false, error: "network_error" };
      }
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
    throw new StubError(last.ok ? "unknown" : last.error, purchaseId, last);
  }

  /** Reclaim a purchase whose deadline passed without delivery. */
  async refund(purchaseId: Hex): Promise<Hex> {
    const tx = await this.o.walletClient.writeContract({ address: this.o.escrow, abi: escrowAbi, functionName: "refund", args: [purchaseId] });
    if ((await waitMined(this.o.publicClient, tx)) === "reverted") throw new StubError("refund_reverted", purchaseId);
    return tx;
  }
}

/** Extracts the custom error name (e.g. OverDailyCap) from a viem contract revert. */
function revertName(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur; i++) {
    const data = (cur as { data?: { errorName?: string } }).data;
    if (data?.errorName) return data.errorName;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Browser crash-safe pending store (localStorage). Falls back to memory when storage is blocked. */
export function localStoragePending(prefix = "stub:sdk:"): PendingStore {
  const mem = memoryPending();
  const ok = (() => {
    try {
      localStorage.setItem(`${prefix}probe`, "1");
      localStorage.removeItem(`${prefix}probe`);
      return true;
    } catch {
      return false;
    }
  })();
  if (!ok) return mem;
  return {
    get: async (k) => {
      try {
        const v = localStorage.getItem(prefix + k);
        return v ? (JSON.parse(v) as Pending) : null;
      } catch {
        return mem.get(k);
      }
    },
    set: async (k, v) => {
      try {
        localStorage.setItem(prefix + k, JSON.stringify(v));
      } catch {
        await mem.set(k, v);
      }
    },
    delete: async (k) => {
      try {
        localStorage.removeItem(prefix + k);
      } catch {
        await mem.delete(k);
      }
    },
  };
}
