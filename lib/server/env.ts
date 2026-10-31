import { z } from "zod";
import { isAddress, type Address } from "viem";
import { isGatewayKey } from "./gatewayKey.mjs";

const address = z.string().refine(isAddress, "must be a 0x address").transform((v) => v as Address);

/** Public, non-secret config needed by read-only endpoints. */
const PublicEnv = z.object({
  VITE_CHAIN: z.enum(["testnet", "mainnet"]).default("testnet"),
  ARC_TESTNET_RPC_URL: z.string().url().default("https://rpc.testnet.arc.io"),
  ARC_MAINNET_RPC_URL: z.string().url().default("https://rpc.mainnet.arc.io"),
  VITE_ESCROW_ADDRESS: address,
});

/** Secrets used only by /api/call. Validated lazily so read endpoints work without them. */
const SecretEnv = z.object({
  FULFILLER_PRIVATE_KEY: z.string().refine(isGatewayKey, "must be a 0x-prefixed valid secp256k1 private key"),
  GEMINI_API_KEY: z.string().min(10),
  // Pinned, not *-latest: an alias can migrate to a model that is slower than the request
  // budget (gemini-3.8-flash took ~290s for one brief on the free tier). The two must differ,
  // because the free-tier daily request cap is per model.
  GEMINI_MODEL: z.string().default("gemini-3.5-flash-lite"),
  GEMINI_FALLBACK_MODEL: z.string().default("gemini-3.6-flash"),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(10),
});

export function publicEnv() {
  const parsed = PublicEnv.safeParse(process.env);
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((i) => i.path.join(".")).join(", "));
  return parsed.data;
}

export function secretEnv() {
  const parsed = SecretEnv.safeParse(process.env);
  // Only report WHICH variables are missing, never their values.
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((i) => i.path.join(".")).join(", "));
  return parsed.data;
}

export class ConfigError extends Error {
  constructor(missing: string) {
    super(`Server is missing or has invalid env: ${missing}`);
  }
}
