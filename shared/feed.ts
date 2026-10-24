// Event feed shared by the API (/api/feed) and the browser fallback scanner.
import { parseAbiItem, type Address, type Hex, type PublicClient } from "viem";

export type FeedStatus = "Locked" | "Released" | "Refunded";
export type FeedItem = {
  purchaseId: Hex;
  serviceId: string;
  payer: Address;
  buyer: Address;
  amount: string; // USDC base units (6 decimals), as string for JSON
  deadline: string;
  lockedBlock: string;
  lockTx: Hex;
  inputHash?: Hex;
  status: FeedStatus;
  releaseTx?: Hex;
  merchantAmount?: string;
  feeAmount?: string;
  resultHash?: Hex;
  refundTx?: Hex;
  early?: boolean;
};
export type FeedTotals = { purchases: number; released: number; refunded: number; volumeReleased: string; fees: string };
export type FeedDoc = { cursor: string; items: FeedItem[]; totals: FeedTotals; updatedAt: number; chainId: number };

export const LOCKED = parseAbiItem(
  "event PurchaseLocked(bytes32 indexed purchaseId, uint64 indexed serviceId, address indexed payer, address buyer, uint96 amount, uint64 deadline, bytes32 inputHash)",
);
export const FULFILLED = parseAbiItem("event PurchaseFulfilled(bytes32 indexed purchaseId, bytes32 resultHash, uint96 merchantAmount, uint96 feeAmount)");
export const REFUNDED = parseAbiItem("event PurchaseRefunded(bytes32 indexed purchaseId, address indexed payer, uint96 amount, bool early)");

/** Arc's public RPC rejects eth_getLogs ranges much above 5,000 blocks. */
export const MAX_LOG_RANGE = 5_000n;
export const MAX_ITEMS = 300;

export const emptyDoc = (fromBlock: bigint, chainId: number): FeedDoc => ({
  cursor: (fromBlock - 1n).toString(),
  items: [],
  totals: { purchases: 0, released: 0, refunded: 0, volumeReleased: "0", fees: "0" },
  updatedAt: 0,
  chainId,
});

/**
 * Advances `doc` by scanning at most `maxChunks` ranges of MAX_LOG_RANGE blocks after its cursor.
 * Pure accumulation: totals only ever grow from events, so re-running from the same cursor is never
 * double counted (the cursor moves only after a chunk is fully applied).
 */
export async function advanceFeed(client: PublicClient, escrow: Address, doc: FeedDoc, maxChunks: number, chunk = MAX_LOG_RANGE): Promise<FeedDoc> {
  const head = await client.getBlockNumber({ cacheTime: 0 });
  let cursor = BigInt(doc.cursor);
  const byId = new Map(doc.items.map((i) => [i.purchaseId, { ...i }]));
  const t = { ...doc.totals, volumeReleased: BigInt(doc.totals.volumeReleased), fees: BigInt(doc.totals.fees) };

  for (let n = 0; n < maxChunks && cursor < head; n++) {
    const fromBlock = cursor + 1n;
    const toBlock = fromBlock + chunk - 1n > head ? head : fromBlock + chunk - 1n;
    const [locked, fulfilled, refunded] = await Promise.all([
      client.getLogs({ address: escrow, event: LOCKED, fromBlock, toBlock }),
      client.getLogs({ address: escrow, event: FULFILLED, fromBlock, toBlock }),
      client.getLogs({ address: escrow, event: REFUNDED, fromBlock, toBlock }),
    ]);
    for (const l of locked) {
      const a = l.args;
      byId.set(a.purchaseId!, {
        purchaseId: a.purchaseId!,
        serviceId: a.serviceId!.toString(),
        payer: a.payer!,
        buyer: a.buyer!,
        amount: a.amount!.toString(),
        deadline: a.deadline!.toString(),
        lockedBlock: l.blockNumber.toString(),
        lockTx: l.transactionHash,
        inputHash: a.inputHash,
        status: "Locked",
      });
      t.purchases++;
    }
    for (const l of fulfilled) {
      const it = byId.get(l.args.purchaseId!);
      t.released++;
      t.volumeReleased += l.args.merchantAmount! + l.args.feeAmount!;
      t.fees += l.args.feeAmount!;
      if (it) Object.assign(it, { status: "Released", releaseTx: l.transactionHash, merchantAmount: l.args.merchantAmount!.toString(), feeAmount: l.args.feeAmount!.toString(), resultHash: l.args.resultHash });
    }
    for (const l of refunded) {
      const it = byId.get(l.args.purchaseId!);
      t.refunded++;
      if (it) Object.assign(it, { status: "Refunded", refundTx: l.transactionHash, early: l.args.early });
    }
    cursor = toBlock;
  }

  const items = [...byId.values()].sort((a, b) => Number(BigInt(b.lockedBlock) - BigInt(a.lockedBlock))).slice(0, MAX_ITEMS);
  return {
    cursor: cursor.toString(),
    items,
    totals: { ...t, volumeReleased: t.volumeReleased.toString(), fees: t.fees.toString() },
    updatedAt: Date.now(),
    chainId: doc.chainId,
  };
}
