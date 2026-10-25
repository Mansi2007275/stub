import type { Address, PublicClient } from "viem";
import { advanceFeed, emptyDoc, type FeedDoc } from "../../shared/feed.js";
import type { Store } from "./store.js";

/**
 * Returns the cached feed, first advancing it by a bounded number of log chunks.
 * One scanner at a time (Redis SET NX); concurrent callers get the cached document.
 * Keyed by escrow so a new deployment (e.g. mainnet) never inherits another contract's history.
 */
export async function getFeed(client: PublicClient, escrow: Address, store: Store, deployBlock: bigint, maxChunks = 12): Promise<FeedDoc> {
  const DOC = `stub:feed:v1:${escrow.toLowerCase()}`;
  const LOCK = `stub:feed:lock:${escrow.toLowerCase()}`;

  const raw = await store.get(DOC);
  let doc: FeedDoc = raw ? (JSON.parse(raw) as FeedDoc) : emptyDoc(deployBlock, await client.getChainId());
  if (BigInt(doc.cursor) < deployBlock - 1n) doc = emptyDoc(deployBlock, doc.chainId);

  if (Date.now() - doc.updatedAt < 4_000) return doc; // cheap cache between bursts of requests
  if (!(await store.set(LOCK, "1", { nx: true, ex: 30 }))) return doc;
  try {
    doc = await advanceFeed(client, escrow, doc, maxChunks);
    await store.set(DOC, JSON.stringify(doc));
    return doc;
  } finally {
    await store.del(LOCK);
  }
}
