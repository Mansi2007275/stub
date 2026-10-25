import { getChain } from "../lib/server/chain.js";
import { handler } from "../lib/server/http.js";
import { getFeed } from "../lib/server/feedCore.js";
import { upstashStore } from "../lib/server/store.js";
import { ConfigError } from "../lib/server/env.js";

/**
 * GET /api/feed — latest purchases and running totals, built from escrow events.
 * Scans forward from VITE_ESCROW_DEPLOY_BLOCK in 5,000-block chunks, keeping its cursor in Redis.
 */
export default handler(["GET"], async (_req, res) => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const deploy = process.env.VITE_ESCROW_DEPLOY_BLOCK;
  if (!url || !token) throw new ConfigError("UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN");
  if (!deploy || !/^\d+$/.test(deploy)) throw new ConfigError("VITE_ESCROW_DEPLOY_BLOCK");

  const { client, escrow } = getChain();
  const doc = await getFeed(client, escrow, upstashStore(url, token), BigInt(deploy));
  res.setHeader("Cache-Control", "public, max-age=3, stale-while-revalidate=10");
  res.status(200).json({ ...doc, items: doc.items.slice(0, 60) });
});
