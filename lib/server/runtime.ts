import { createWalletClient, http } from "viem";
import { parseGatewayKey } from "./gatewayKey.mjs";
import { getChain } from "./chain.js";
import { secretEnv } from "./env.js";
import { geminiGenerator } from "./pitchBrief.js";
import { upstashStore } from "./store.js";
import type { Deps } from "./callCore.js";

/** Builds production dependencies from env. Secrets never leave the server. */
export function productionDeps(): Deps {
  const { chain, client, escrow } = getChain();
  const s = secretEnv();
  const rpc = process.env.VITE_CHAIN === "mainnet" ? process.env.ARC_MAINNET_RPC_URL : process.env.ARC_TESTNET_RPC_URL;
  const wallet = createWalletClient({
    account: parseGatewayKey(s.FULFILLER_PRIVATE_KEY),
    chain,
    transport: http(rpc || chain.rpcUrls.default.http[0], { timeout: 10_000, retryCount: 2 }),
  });
  return {
    client,
    wallet,
    escrow,
    serviceId: BigInt(process.env.VITE_SERVICE_ID || "1"),
    store: upstashStore(s.UPSTASH_REDIS_REST_URL, s.UPSTASH_REDIS_REST_TOKEN),
    generate: geminiGenerator(s.GEMINI_API_KEY, [s.GEMINI_MODEL, s.GEMINI_FALLBACK_MODEL]),
  };
}

export function clientIp(headers: Record<string, string | string[] | undefined>): string {
  const xf = headers["x-forwarded-for"];
  const v = Array.isArray(xf) ? xf[0] : xf;
  return (v?.split(",")[0] ?? "unknown").trim().slice(0, 64);
}
