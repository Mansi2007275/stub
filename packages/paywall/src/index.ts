/**
 * @stub/paywall — sell any function as a pay-per-call API, settled through StubEscrow on Arc.
 *
 *   const paywall = stubPaywall({ escrow, serviceId: 2n, fulfillerKey, rpcUrl, chain: arcTestnet,
 *     store: upstash(url, token), handler: async (input) => ({ answer: await myApi(input) }) });
 *   export default { fetch: paywall.fetch };          // Vercel / Next / Bun / Deno / Workers
 *   app.post("/stub/:op", express.json(), paywall.express); // Express
 *
 * You register the service once (on /merchant or registerService) with `fulfiller` = this key's address.
 * Buyers use @stub/sdk with apiBase pointing at wherever you mounted the paywall.
 * Your handler only runs for a purchase that is Locked on-chain, for this service, signed by the payer,
 * with exactly the input they paid for. If it throws, the buyer is refunded in the same request.
 */
import { createPublicClient, createWalletClient, http, type Address, type Chain, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { processCall } from "../../../lib/server/callCore";
import { processQuote } from "../../../lib/server/quoteCore";
import { ProviderError } from "../../../lib/server/pitchBrief";
import { keys, memoryStore, upstashStore, type Store } from "../../../lib/server/store";

export { ProviderError, memoryStore, upstashStore };
export type { Store };

export type PaywallConfig<T> = {
  escrow: Address;
  serviceId: bigint;
  /** Private key of the service's fulfiller. Keep it server-side with a tiny gas balance. */
  fulfillerKey: Hex;
  rpcUrl: string;
  chain: Chain;
  /** Persistent store (Upstash in production). In-memory is fine only for single-process dev. */
  store?: Store;
  /** Your paid work. Return any JSON-serialisable value. Throw to refund the buyer. */
  handler: (input: string) => Promise<T>;
  rateLimitPerMinute?: number;
  maxBodyBytes?: number;
};

export type Paywall = {
  quote(body: unknown): Promise<{ status: number; body: unknown }>;
  call(body: unknown, clientId?: string): Promise<{ status: number; body: unknown }>;
  /** Web-standard handler: POST …/quote and POST …/call. */
  fetch(req: Request): Promise<Response>;
  /** Express-style handler: mount at a route whose last segment is `quote` or `call`. */
  express(req: { method?: string; path?: string; url?: string; body?: unknown; ip?: string }, res: { status(n: number): { json(b: unknown): void } }): Promise<void>;
};

export function stubPaywall<T>(cfg: PaywallConfig<T>): Paywall {
  const client = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl, { timeout: 10_000, retryCount: 2 }) }) as PublicClient;
  const wallet = createWalletClient({ account: privateKeyToAccount(cfg.fulfillerKey), chain: cfg.chain, transport: http(cfg.rpcUrl, { timeout: 10_000, retryCount: 2 }) });
  const store = cfg.store ?? memoryStore();
  const limit = cfg.rateLimitPerMinute ?? 30;
  const maxBody = cfg.maxBodyBytes ?? 8 * 1024;

  const deps = { client, wallet, escrow: cfg.escrow, serviceId: cfg.serviceId, store, generate: (i: string) => cfg.handler(i) };

  const quote = (body: unknown) => processQuote(client, cfg.escrow, body);
  const call = async (body: unknown, clientId = "anon") => {
    if ((await store.incr(keys.rate(`pw:${cfg.serviceId}:${clientId}`), 60)) > limit) return { status: 429, body: { ok: false, error: "rate_limited" } };
    return processCall(deps, body);
  };

  const route = async (op: string | undefined, body: unknown, clientId?: string) => {
    if (op === "quote") return quote(body);
    if (op === "call") return call(body, clientId);
    return { status: 404, body: { error: "not_found" } };
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });

  return {
    quote,
    call,
    async fetch(req) {
      if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
      const text = await req.text();
      if (text.length > maxBody) return json(413, { error: "body_too_large" });
      let body: unknown;
      try {
        body = JSON.parse(text || "{}");
      } catch {
        return json(400, { error: "invalid_json" });
      }
      const op = new URL(req.url).pathname.split("/").filter(Boolean).pop();
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      try {
        const out = await route(op, body, ip);
        return json(out.status, out.body);
      } catch (e) {
        return json(500, { error: "internal_error", name: (e as Error).name });
      }
    },
    async express(req, res) {
      if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
      if (JSON.stringify(req.body ?? {}).length > maxBody) return res.status(413).json({ error: "body_too_large" });
      const op = (req.path ?? req.url ?? "").split("?")[0].split("/").filter(Boolean).pop();
      try {
        const out = await route(op, req.body, req.ip);
        res.status(out.status).json(JSON.parse(JSON.stringify(out.body, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))));
      } catch (e) {
        res.status(500).json({ error: "internal_error", name: (e as Error).name });
      }
    },
  };
}
