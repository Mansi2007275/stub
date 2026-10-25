import { handler } from "../lib/server/http.js";
import { geminiPing } from "../lib/server/pitchBrief.js";
import { keys, upstashStore } from "../lib/server/store.js";

/**
 * GET /api/health — tells you which config is present (names only, never values).
 * GET /api/health?check=gemini — also sends a one-word request to each configured Gemini model from
 * the server and reports the HTTP status, Google's error status/message and the latency. No secrets.
 */
export default handler(["GET"], async (req, res) => {
  const has = (k: string) => Boolean(process.env[k]);
  const out: Record<string, unknown> = {
    ok: true,
    network: process.env.VITE_CHAIN ?? "testnet",
    configured: {
      escrow: has("VITE_ESCROW_ADDRESS"),
      fulfillerKey: has("FULFILLER_PRIVATE_KEY"),
      gemini: has("GEMINI_API_KEY"),
      redis: has("UPSTASH_REDIS_REST_URL") && has("UPSTASH_REDIS_REST_TOKEN"),
    },
  };

  if (req.query.check === "gemini") {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(200).json({ ...out, gemini: { error: "GEMINI_API_KEY is not set" } });
    // Global cap so this endpoint can't be used to burn the Gemini quota.
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token && (await upstashStore(url, token).incr(keys.rate("health-gemini"), 60)) > 6) {
      return res.status(429).json({ ...out, gemini: { error: "rate_limited, try again in a minute" } });
    }
    const models = [...new Set([process.env.GEMINI_MODEL || "gemini-flash-latest", process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-latest"])];
    out.gemini = { keyLooksLike: key.startsWith("AIza") ? "AIza… (standard key)" : `${key.slice(0, 3)}… (${key.length} chars)`, results: await Promise.all(models.map((m) => geminiPing(key, m))) };
  }

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(out);
});
