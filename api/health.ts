import { handler } from "../lib/server/http.js";

/** GET /api/health — tells you which config is present (names only, never values). */
export default handler(["GET"], async (_req, res) => {
  const has = (k: string) => Boolean(process.env[k]);
  res.status(200).json({
    ok: true,
    network: process.env.VITE_CHAIN ?? "testnet",
    configured: {
      escrow: has("VITE_ESCROW_ADDRESS"),
      fulfillerKey: has("FULFILLER_PRIVATE_KEY"),
      gemini: has("GEMINI_API_KEY"),
      redis: has("UPSTASH_REDIS_REST_URL") && has("UPSTASH_REDIS_REST_TOKEN"),
    },
  });
});
