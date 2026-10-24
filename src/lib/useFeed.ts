// oxlint-disable react/set-state-in-effect -- polling hook intentionally syncs with an external RPC/API
import { useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { advanceFeed, emptyDoc, MAX_LOG_RANGE, type FeedDoc } from "../../shared/feed";
import { API_BASE, DEPLOY_BLOCK, ESCROW_ADDRESS, chain } from "./config";

export type FeedState = { doc: FeedDoc | null; source: "api" | "chain" | "none"; error?: string };

/**
 * Live purchases from the escrow. Prefers the server feed (/api/feed, full history, cached in Redis).
 * If that isn't deployed (local dev, Arc Studio preview) it scans the last ~20k blocks from the browser.
 */
export function useFeed(intervalMs = 8_000): FeedState {
  const client = usePublicClient({ chainId: chain.id });
  const [state, setState] = useState<FeedState>({ doc: null, source: "none" });
  const local = useRef<FeedDoc | null>(null);

  useEffect(() => {
    const escrow = ESCROW_ADDRESS;
    if (!escrow || !client) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const r = await fetch(`${API_BASE}/feed`, { headers: { accept: "application/json" } });
        if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) {
          const doc = (await r.json()) as FeedDoc;
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
          if (live) setState({ doc: local.current, source: "chain" });
        } catch (e) {
          if (live) setState((s) => ({ ...s, error: (e as Error).message }));
        }
      } finally {
        if (live) timer = setTimeout(() => void tick(), intervalMs);
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
