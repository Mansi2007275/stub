/**
 * Error classification for Arc's JSON-RPC endpoints. Deliberately free of `import.meta.env` and of
 * any transport, so it is pure, unit-testable from node, and usable from both sides of the app.
 */

type ErrLike = {
  code?: number; status?: number; name?: string; message?: string; details?: string; shortMessage?: string;
  method?: string; url?: string; cause?: unknown; data?: { code?: number }; metaMessages?: string[];
};

/**
 * viem does not keep the RPC method as a property - it only appears inside the error's
 * `Request body: {"method":"eth_call",...}` meta line. A wallet/provider error may carry it
 * directly. Try both, so every logged failure names the call that produced it.
 */
function methodOf(links: ErrLike[]): string | undefined {
  for (const l of links) {
    if (typeof l.method === "string" && l.method) return l.method;
    const meta = l.metaMessages?.join(" ") ?? "";
    const m = /"method"\s*:\s*"([^"]+)"/.exec(meta);
    if (m) return m[1];
  }
  return undefined;
}

/** Every link of the `cause` chain, outermost first. Handles non-viem (wallet) errors too. */
function chain(e: unknown, out: ErrLike[] = []): ErrLike[] {
  if (!e || typeof e !== "object" || out.length > 12) return out;
  const err = e as ErrLike;
  out.push(err);
  return chain(err.cause, out);
}

/** What actually went wrong, flattened for a single console line. */
export type RpcErrorFacts = { method?: string; code?: number; status?: number; name?: string; message: string; url?: string; busy: boolean };

export function describeRpcError(e: unknown): RpcErrorFacts {
  const links = chain(e);
  const top = links[0] ?? {};
  return {
    method: methodOf(links),
    code: links.find((l) => typeof l.code === "number")?.code ?? links.find((l) => typeof l.data?.code === "number")?.data?.code,
    status: links.find((l) => typeof l.status === "number")?.status,
    name: top.name,
    message: (top.shortMessage || top.message || String(e)).split("\n")[0],
    url: links.find((l) => l.url)?.url,
    busy: isRpcBusy(e),
  };
}

/**
 * True ONLY for the two signals that actually mean "throttled": JSON-RPC error code -32005
 * (viem: LimitExceededRpcError) and HTTP 429. Deliberately structured-only - an earlier version
 * also matched the text /rate limit|exceeds defined limit|429/ against the error message, and
 * because a viem message embeds the whole request dump (addresses + calldata), any unrelated
 * failure whose hex happened to contain "429" was reported to the buyer as "Network is busy".
 */
export function isRpcBusy(e: unknown): boolean {
  return chain(e).some((l) => l.code === -32005 || l.data?.code === -32005 || l.status === 429 || l.name === "LimitExceededRpcError");
}

/** What a buyer sees instead of a raw JSON-RPC error. Never implies a charge that did not happen. */
export const RPC_BUSY_MESSAGE = "Network is busy, retry in a few seconds. You have not been charged.";

/** Always log the raw error next to the facts; the friendly string must never be the only record. */
export function logRpcError(label: string, e: unknown): RpcErrorFacts {
  const f = describeRpcError(e);
  console.error(
    `[rpc:error] ${label} | method=${f.method ?? "?"} code=${f.code ?? "-"} http=${f.status ?? "-"} name=${f.name ?? "?"} busy=${f.busy} url=${f.url ?? "?"}\n  ${f.message}`,
    e,
  );
  return f;
}

/**
 * Retries `fn` only while the RPC is throttling, with exponential backoff. Anything else (a revert,
 * a rejected signature) is a real answer and is rethrown immediately.
 */
export async function withRpcRetry<T>(fn: () => Promise<T>, tries = 5, baseMs = 500, label = "rpc"): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const busy = logRpcError(`${label} attempt ${i + 1}/${tries}`, e).busy;
      if (i >= tries - 1 || !busy) throw e;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
}
