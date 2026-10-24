import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ConfigError } from "./env";

/** Wraps a handler: method guard, JSON errors, and no internal details or secrets in responses. */
export function handler(methods: string[], fn: (req: VercelRequest, res: VercelResponse) => Promise<unknown>) {
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader("Cache-Control", "no-store");
    if (!req.method || !methods.includes(req.method)) {
      res.setHeader("Allow", methods.join(", "));
      return res.status(405).json({ error: "method_not_allowed" });
    }
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof ConfigError) return res.status(503).json({ error: "not_configured", detail: err.message });
      console.error("[api]", req.url, (err as Error)?.name); // log the type only, never payloads or keys
      return res.status(500).json({ error: "internal_error" });
    }
  };
}

export const jsonSafe = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
