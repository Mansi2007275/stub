// oxlint-disable react/set-state-in-effect -- polling hook intentionally syncs with an external RPC/API
import { useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { advanceFeed, emptyDoc, MAX_LOG_RANGE, type FeedDoc } from "../../shared/feed";
import { API_BASE, DEPLOY_BLOCK, ESCROW_ADDRESS, chain } from "./config";
import { isRpcBusy } from "./rpc";
import { isPaymentInProgress } from "./payCall";

export type FeedState = { doc: FeedDoc | null; source: "api" | "chain" | "none"; error?: string };

/** Arc's RPCs throttle aggressively, so the wall refreshes at a human pace rather than per second. */
const DEFAULT_INTERVAL_MS = 30_000;
/** Longest wait after repeated throttling, so a busy network cannot be hammered. */
const MAX_BACKOFF_MS = 240_000;

/**
 * Live purchases from the escrow. Prefers the server feed (/api/feed, full history, cached in Redis
 * and shared by every visitor). Only if that is unavailable does it scan a bounded recent window
 * from the browser, in MAX_LOG_RANGE chunks starting no earlier than the deploy block.
 *
 * Polling stands down entirely while a payment is in flight: a buyer's approve/pay calls must never
 * lose the rate-limit race to a background refresh.
 */
export function useFeed(intervalMs = DEFAULT_INTERVAL_MS): FeedState {
  const client = usePublicClient({ chainId: chain.id });
  const [state, setState] = useState<FeedState>({ doc: null, source: "none" });
  const local = useRef<FeedDoc | null>(null);

  useEffect(() => {
    const escrow = ESCROW_ADDRESS;
    if (!escrow || !client) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    let backoff = 0;

    const tick = async () => {
      // Never compete with a purchase for the RPC budget; check again shortly.
      if (isPaymentInProgress()) {
        if (live) timer = setTimeout(() => void tick(), 3_000);
        return;
      }
      let wait = intervalMs;
      try {
        const r = await fetch(`${API_BASE}/feed`, { headers: { accept: "application/json" } });
        if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) {
          const doc = (await r.json()) as FeedDoc;
          backoff = 0;
          if (live) setState({ doc, source: "api" });
          return;
        }
        throw new Error(`feed_${r.status}`);
      } catch {
        try {
          if (!local.current) {
            const head = await client.getBlockNumber({ cacheTime: 0 });
            const recent = head > MAX_LOG_RANGE * 4n ? head - MAX_LOG_RANGE * 4n : 0n;
            const from = DEPLOY_BLOCK !== undefined && DEPLOY_BLOCK > recent ? DEPLOY_BLOCK : recent;
            local.current = emptyDoc(from, chain.id);
          }
          local.current = await advanceFeed(client, escrow, local.current, 4);
          backoff = 0;
          if (live) setState({ doc: local.current, source: "chain" });
        } catch (e) {
          // Throttling is not a failure of the app: back off and keep whatever we already showed.
          if (isRpcBusy(e)) {
            backoff = Math.min(backoff ? backoff * 2 : intervalMs, MAX_BACKOFF_MS);
            wait = backoff;
            if (live) setState((s) => ({ ...s, error: "Network is busy, retrying shortly." }));
          } else if (live) {
            setState((s) => ({ ...s, error: (e as Error).message }));
          }
        }
      } finally {
        if (live) timer = setTimeout(() => void tick(), wait);
      }
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, intervalMs]);

  return state;
}
