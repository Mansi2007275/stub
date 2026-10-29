import { createPublicClient, fallback, http } from "viem";
import { arc, arcTestnet } from "viem/chains";
import { publicEnv } from "./env.js";
import { escrowAbi } from "./escrowAbi.js";

/**
 * Arc's public RPCs answer -32005 "rate limit exceeded" on ordinary eth_call under light load, and
 * they do not throttle together. Measured on Arc Testnet: rpc.testnet.arc.io and rpc.quicknode.*
 * throttle early; rpc.blockdaemon.* and rpc.drpc.* stayed healthy. The server therefore keeps an
 * ordered list and moves on rather than failing a paid call.
 */
const KNOWN_GOOD = {
  testnet: ["https://rpc.blockdaemon.testnet.arc.io", "https://rpc.drpc.testnet.arc.io", "https://rpc.testnet.arc.io", "https://rpc.quicknode.testnet.arc.io"],
  mainnet: ["https://rpc.mainnet.arc.io", "https://rpc.blockdaemon.mainnet.arc.io", "https://rpc.drpc.mainnet.arc.io"],
} as const;

export type ServerRpcCall = { at: number; url: string; method: string; detail?: string; status?: number; ms?: number; rpcCode?: number; rpcMessage?: string };

const CALL_LOG: ServerRpcCall[] = [];

/** Server-side RPC calls from the last `seconds`, oldest first. */
export function recentRpcCalls(seconds = 60): ServerRpcCall[] {
  const since = Date.now() - seconds * 1000;
  return CALL_LOG.filter((c) => c.at >= since);
}

const blockRange = (params: unknown): string | undefined => {
  const p = (Array.isArray(params) ? params[0] : params) as { fromBlock?: string; toBlock?: string } | undefined;
  if (!p?.fromBlock && !p?.toBlock) return undefined;
  const n = (v?: string) => (v && /^0x[0-9a-f]+$/i.test(v) ? String(BigInt(v)) : v);
  return `blocks ${n(p.fromBlock) ?? "?"}..${n(p.toBlock) ?? "?"}`;
};

const detailOf = (method: string, params: unknown): string | undefined => {
  const range = blockRange(params);
  if (range) return range;
  if (method === "eth_call") {
    const p = (params as [{ to?: string; data?: string }] | undefined)?.[0];
    return p?.to ? `to=${p.to} selector=${p.data?.slice(0, 10) ?? "?"}` : undefined;
  }
  return undefined;
};

/**
 * Wraps one endpoint so every JSON-RPC request is recorded with its method, block range, HTTP
 * status and JSON-RPC error code. Set RPC_DEBUG=1 to echo each call to the server console; errors
 * are always logged, so a throttled endpoint is never mistaken for a broken contract call.
 */
function loggedHttp(url: string) {
  const pending = new Map<string, { at: number; method: string; detail?: string }>();
  return http(url, {
    timeout: 12_000,
    retryCount: 2,
    retryDelay: 400,
    onFetchRequest(_request, init) {
      try {
        const parsed = JSON.parse(String((init as { body?: unknown }).body ?? "{}")) as { id?: number; method?: string; params?: unknown } | { id?: number; method?: string; params?: unknown }[];
        const first = Array.isArray(parsed) ? parsed[0] : parsed;
        const method = Array.isArray(parsed) ? `batch(${parsed.length}) ${first?.method ?? "?"}` : (first?.method ?? "?");
        pending.set(String(first?.id ?? ""), { at: Date.now(), method, detail: detailOf(first?.method ?? "", first?.params) });
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
      const call: ServerRpcCall = { at, url, method: entry?.method ?? "?", detail: entry?.detail, status: response.status, ms: Date.now() - at };
      const rpcErr = (Array.isArray(body) ? body.find((b) => b?.error) : body)?.error;
      if (rpcErr) {
        call.rpcCode = rpcErr.code;
        call.rpcMessage = rpcErr.message;
      }
      CALL_LOG.push(call);
      if (CALL_LOG.length > 500) CALL_LOG.splice(0, CALL_LOG.length - 500);
      const bad = call.status !== 200 || call.rpcCode !== undefined;
      if (bad || process.env.RPC_DEBUG === "1") {
        const line = `[rpc] ${call.method}${call.detail ? ` (${call.detail})` : ""} -> HTTP ${call.status}${call.rpcCode === undefined ? "" : ` rpc ${call.rpcCode} ${call.rpcMessage ?? ""}`} ${call.ms}ms @ ${new URL(url).host}`;
        if (bad) console.error(line);
        else console.log(line);
      }
    },
  });
}

export function getChain() {
  const env = publicEnv();
  const mainnet = env.VITE_CHAIN === "mainnet";
  const chain = mainnet ? arc : arcTestnet;
  const primary = mainnet ? env.ARC_MAINNET_RPC_URL : env.ARC_TESTNET_RPC_URL;
  // Configured primary first, then RPC_URL_FALLBACK, then the rest of the known endpoints.
  const urls = [...new Set([primary, process.env.RPC_URL_FALLBACK, ...KNOWN_GOOD[mainnet ? "mainnet" : "testnet"]].filter(Boolean))] as string[];
  const client = createPublicClient({
    chain,
    transport: fallback(urls.map(loggedHttp), { rank: false, retryCount: 1, retryDelay: 600 }),
  });
  return { chain, client, escrow: env.VITE_ESCROW_ADDRESS, abi: escrowAbi };
}

export const STATUS = ["None", "Locked", "Fulfilled", "Refunded"] as const;
