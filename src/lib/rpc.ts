import { fallback, http } from "viem";
import { NETWORK, RPC_URL } from "./config";

const env = import.meta.env;

/**
 * Arc's public RPCs answer `-32005 rate limit exceeded` (surfaced by viem as "Request exceeds
 * defined limit") on plain eth_call under light load, and they do not all fail at the same time.
 * Measured on Arc Testnet: rpc.testnet.arc.io and rpc.quicknode.* throttle early, while
 * rpc.blockdaemon.* and rpc.drpc.* stayed healthy, so the browser keeps an ordered list and moves
 * on instead of failing the buyer's purchase.
 */
export const KNOWN_GOOD: Record<"mainnet" | "testnet", string[]> = {
  testnet: ["https://rpc.blockdaemon.testnet.arc.io", "https://rpc.drpc.testnet.arc.io", "https://rpc.testnet.arc.io", "https://rpc.quicknode.testnet.arc.io"],
  mainnet: ["https://rpc.mainnet.arc.io", "https://rpc.blockdaemon.mainnet.arc.io", "https://rpc.drpc.mainnet.arc.io"],
};

/** Configured primary first, then VITE_RPC_URL_FALLBACK, then the rest of the known endpoints. */
export const RPC_URLS: string[] = [...new Set([RPC_URL, ...(env.VITE_RPC_URL_FALLBACK ? [env.VITE_RPC_URL_FALLBACK] : []), ...KNOWN_GOOD[NETWORK]].filter(Boolean))];

// ---------------------------------------------------------------------------
// Call log: every JSON-RPC request this tab makes, so a failure can be traced
// to a method, an endpoint and an HTTP status instead of being guessed at.
// ---------------------------------------------------------------------------

export type RpcCall = { at: number; url: string; method: string; params?: string; status?: number; ms?: number; rpcCode?: number; rpcMessage?: string };

const CALL_LOG: RpcCall[] = [];
const LOG_MAX = 300;

const push = (c: RpcCall) => {
  CALL_LOG.push(c);
  if (CALL_LOG.length > LOG_MAX) CALL_LOG.splice(0, CALL_LOG.length - LOG_MAX);
};

/** Calls from the last `seconds`, newest last. */
export const recentRpcCalls = (seconds = 60): RpcCall[] => {
  const since = Date.now() - seconds * 1000;
  return CALL_LOG.filter((c) => c.at >= since);
};

/** Block range of an eth_getLogs / eth_call params blob, for readable logs. */
const blockRange = (params: unknown): string | undefined => {
  const p = (Array.isArray(params) ? params[0] : params) as { fromBlock?: string; toBlock?: string } | undefined;
  if (!p?.fromBlock && !p?.toBlock) return undefined;
  const n = (v?: string) => (v && /^0x[0-9a-f]+$/i.test(v) ? String(BigInt(v)) : v);
  return `${n(p.fromBlock) ?? "?"}..${n(p.toBlock) ?? "?"}`;
};

const summarizeParams = (method: string, params: unknown): string | undefined => {
  const range = blockRange(params);
  if (range) return `blocks ${range}`;
  if (method === "eth_call") {
    const p = (params as [{ to?: string; data?: string }] | undefined)?.[0];
    return p?.to ? `to=${p.to} selector=${p.data?.slice(0, 10) ?? "?"}` : undefined;
  }
  return undefined;
};

/** Wraps one endpoint so each request is timed, logged and attributable to a URL. */
function loggedHttp(url: string) {
  const pending = new Map<string, { at: number; method: string; params?: string }>();
  return http(url, {
    retryCount: 2,
    retryDelay: 400,
    timeout: 15_000,
    onFetchRequest(_request, init) {
      try {
        const parsed = JSON.parse(String((init as { body?: unknown }).body ?? "{}")) as { id?: number; method?: string; params?: unknown } | { id?: number; method?: string; params?: unknown }[];
        const first = Array.isArray(parsed) ? parsed[0] : parsed;
        const method = Array.isArray(parsed) ? `batch(${parsed.length}) ${first?.method ?? "?"}` : (first?.method ?? "?");
        pending.set(String(first?.id ?? ""), { at: Date.now(), method, params: summarizeParams(first?.method ?? "", first?.params) });
      } catch {
        /* never let logging break a request */
      }
    },
    async onFetchResponse(response) {
      type Payload = { id?: number; error?: { code?: number; message?: string } };
      let body: Payload | Payload[] | undefined;
      try {
        body = (await response.clone().json()) as Payload | Payload[];
      } catch {
        /* non-JSON body (an HTML 429 page, say) - the status is still useful */
      }
      const first = Array.isArray(body) ? body[0] : body;
      // Pair request to response by JSON-RPC id: several calls can be in flight on one endpoint.
      const id = String(first?.id ?? "");
      const entry = pending.get(id) ?? [...pending.values()][0];
      pending.delete(pending.has(id) ? id : ([...pending.keys()][0] ?? id));
      const at = entry?.at ?? Date.now();
      const call: RpcCall = { at, url, method: entry?.method ?? "?", params: entry?.params, status: response.status, ms: Date.now() - at };
      const rpcErr = (Array.isArray(body) ? body.find((b) => b?.error) : body)?.error;
      if (rpcErr) {
        call.rpcCode = rpcErr.code;
        call.rpcMessage = rpcErr.message;
      }
      push(call);
      if (call.status !== 200 || call.rpcCode !== undefined) {
        console.error(`[rpc] ${call.method}${call.params ? ` (${call.params})` : ""} -> HTTP ${call.status}${call.rpcCode === undefined ? "" : ` rpc ${call.rpcCode} ${call.rpcMessage ?? ""}`} @ ${url}`);
      }
    },
  });
}

/** Every endpoint in order, each with its own bounded exponential backoff. */
export const makeTransport = (urls: string[]) => fallback(urls.map(loggedHttp), { rank: false, retryCount: 1, retryDelay: 600 });

/** Shared transport for the configured network. */
export const arcTransport = makeTransport(RPC_URLS);

// Error classification lives in ./rpcError (pure, no env), and is re-exported so that
// `import { isRpcBusy } from "./rpc"` keeps working for callers that already use the transport.
import { describeRpcError } from "./rpcError";
export { RPC_BUSY_MESSAGE, describeRpcError, isRpcBusy, logRpcError, withRpcRetry, type RpcErrorFacts } from "./rpcError";

if (typeof window !== "undefined") {
  // Lets a failure be inspected after the fact: __stubRpc.recent(60) in the console.
  (window as unknown as { __stubRpc: unknown }).__stubRpc = { recent: recentRpcCalls, urls: RPC_URLS, describe: describeRpcError };
}
