import { handler } from "../lib/server/http.js";
import { processCall } from "../lib/server/callCore.js";
import { productionDeps, clientIp } from "../lib/server/runtime.js";
import { keys } from "../lib/server/store.js";

const MAX_BODY_BYTES = 8 * 1024;
const RATE_PER_MINUTE = 20;

/** POST /api/call { purchaseId, input, signature } — runs a paid call and releases escrow. */
export default handler(["POST"], async (req, res) => {
  const len = Number(req.headers["content-length"] ?? 0);
  if (len > MAX_BODY_BYTES || JSON.stringify(req.body ?? {}).length > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: "body_too_large" });
  }

  const deps = productionDeps();
  const hits = await deps.store.incr(keys.rate(clientIp(req.headers)), 60);
  if (hits > RATE_PER_MINUTE) return res.status(429).json({ ok: false, error: "rate_limited" });

  const out = await processCall(deps, req.body);
  res.status(out.status).json(out.body);
});
