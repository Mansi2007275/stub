import { createPublicClient, http } from "viem";
import { arc, arcTestnet } from "viem/chains";
import { publicEnv } from "./env.js";
import { escrowAbi } from "./escrowAbi.js";

export function getChain() {
  const env = publicEnv();
  const chain = env.VITE_CHAIN === "mainnet" ? arc : arcTestnet;
  const rpc = env.VITE_CHAIN === "mainnet" ? env.ARC_MAINNET_RPC_URL : env.ARC_TESTNET_RPC_URL;
  const client = createPublicClient({ chain, transport: http(rpc, { timeout: 8_000, retryCount: 2 }) });
  return { chain, client, escrow: env.VITE_ESCROW_ADDRESS, abi: escrowAbi };
}

export const STATUS = ["None", "Locked", "Fulfilled", "Refunded"] as const;
