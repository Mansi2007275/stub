import { arc, arcTestnet } from "viem/chains";
import { isAddress, type Address } from "viem";

const env = import.meta.env;

export const NETWORK: "mainnet" | "testnet" = env.VITE_CHAIN === "mainnet" ? "mainnet" : "testnet";
export const chain = NETWORK === "mainnet" ? arc : arcTestnet;

export const RPC_URL =
  NETWORK === "mainnet"
    ? env.VITE_ARC_MAINNET_RPC_URL || "https://rpc.mainnet.arc.io"
    : env.VITE_ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.io";

export const EXPLORER = NETWORK === "mainnet" ? "https://explorer.arc.io" : "https://explorer.testnet.arc.io";

function addr(v: string | undefined): Address | undefined {
  return v && isAddress(v) ? v : undefined;
}

export const USDC_ADDRESS: Address = addr(env.VITE_USDC_ADDRESS) ?? "0x3600000000000000000000000000000000000000";
export const ESCROW_ADDRESS = addr(env.VITE_ESCROW_ADDRESS);
export const SERVICE_ID = BigInt(env.VITE_SERVICE_ID || "1");
export const API_BASE = env.VITE_API_BASE || "/api";

/** USDC ERC-20 interface on Arc uses 6 decimals. Never use 18 (that's native gas units). */
export const USDC_DECIMALS = 6;

export const isDeployed = Boolean(ESCROW_ADDRESS);

export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;

/** Block of the escrow deploy tx; the browser feed fallback never scans before it. */
export const DEPLOY_BLOCK = /^\d+$/.test(env.VITE_ESCROW_DEPLOY_BLOCK ?? "") ? BigInt(env.VITE_ESCROW_DEPLOY_BLOCK!) : undefined;

/** ERC-8004 IdentityRegistry (agent identities, ERC-721) — from docs.arc.io contract addresses. */
export const IDENTITY_REGISTRY: Address =
  NETWORK === "mainnet" ? "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" : "0x8004A818BFB912233c491871b3d84c89A494BD9e";
