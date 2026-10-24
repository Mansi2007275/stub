/**
 * Shared setup for the demo scripts.
 *  --local     start a throwaway anvil chain + local gateway (no keys, no real money). LOCAL evidence only.
 *  (default)   use a deployed Stub: STUB_API, STUB_ESCROW, STUB_CHAIN=testnet|mainnet, BUYER_PRIVATE_KEY.
 */
import { createPublicClient, createWalletClient, http, isAddress, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arc, arcTestnet } from "viem/chains";
import { startLocalStack, type LocalStack, type Who } from "../lib/dev/localStack";
import { geminiGenerator, type Generate } from "../lib/server/pitchBrief";
import type { PitchBrief } from "../shared/protocol";

export const isLocal = process.argv.includes("--local");
export const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));

/** Clearly-labelled offline brief so local demos run without any API key. */
export const mockGenerate: Generate = async (idea): Promise<PitchBrief> => ({
  title: `[LOCAL MOCK] ${idea.split(/\s+/).slice(0, 4).join(" ")}`,
  oneLiner: idea.slice(0, 160),
  problem: `People affected by: ${idea.slice(0, 120)}`,
  customer: "To be validated: name the first 10 paying customers.",
  solution: idea.slice(0, 200),
  market: "Size bottom-up: count reachable customers × price.",
  businessModel: "Per-transaction fee (to validate).",
  moat: "Speed of execution and early customer relationships.",
  risks: ["Unvalidated demand", "Distribution cost"],
  slides: ["Problem", "Solution", "Customer & market", "Business model", "Why now"].map((t) => ({ title: t, bullets: ["(mock)", "(mock)"] })),
});

export type Ctx = {
  label: "LOCAL CHAIN" | "ARC TESTNET" | "ARC MAINNET";
  apiBase: string;
  escrow: Address;
  usdc: Address;
  serviceId: bigint;
  explorer: string;
  publicClient: PublicClient;
  wallet: (role: "buyer" | "agent" | "owner" | "deckApp") => WalletClient<Transport, Chain, Account>;
  stack?: LocalStack;
  close: () => Promise<void>;
};

const need = (k: string) => {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing ${k}. Set it, or run with --local.`);
    process.exit(2);
  }
  return v;
};

export async function setup(): Promise<Ctx> {
  if (isLocal) {
    const generate = process.env.GEMINI_API_KEY ? geminiGenerator(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL ?? "gemini-2.5-flash") : mockGenerate;
    const stack = await startLocalStack({ generate });
    const map: Record<string, Who> = { buyer: "buyer", agent: "agent", owner: "buyer", deckApp: "deckApp" };
    return {
      label: "LOCAL CHAIN",
      apiBase: stack.apiBase,
      escrow: stack.escrow,
      usdc: stack.usdc,
      serviceId: stack.serviceId,
      explorer: "(local anvil, no explorer)",
      publicClient: stack.client,
      wallet: (r) => stack.wallet(map[r]),
      stack,
      close: stack.stop,
    };
  }
  const chainName = process.env.STUB_CHAIN === "mainnet" ? "mainnet" : "testnet";
  const chain = chainName === "mainnet" ? arc : arcTestnet;
  const rpc = process.env.STUB_RPC ?? chain.rpcUrls.default.http[0];
  const escrow = need("STUB_ESCROW");
  if (!isAddress(escrow)) throw new Error("STUB_ESCROW is not an address");
  const publicClient = createPublicClient({ chain, transport: http(rpc) }) as PublicClient;
  const keys: Record<string, string | undefined> = {
    buyer: process.env.BUYER_PRIVATE_KEY,
    agent: process.env.AGENT_PRIVATE_KEY ?? process.env.DECK_AGENT_PRIVATE_KEY,
    owner: process.env.BUYER_PRIVATE_KEY,
    deckApp: process.env.DECK_AGENT_PRIVATE_KEY,
  };
  return {
    label: chainName === "mainnet" ? "ARC MAINNET" : "ARC TESTNET",
    apiBase: need("STUB_API").replace(/\/$/, ""),
    escrow,
    usdc: "0x3600000000000000000000000000000000000000",
    serviceId: BigInt(process.env.STUB_SERVICE_ID ?? "1"),
    explorer: chainName === "mainnet" ? "https://explorer.arc.io" : "https://explorer.testnet.arc.io",
    publicClient,
    wallet: (r) => {
      const k = keys[r];
      if (!k) {
        console.error(`Missing private key for role "${r}" (see examples/README.md).`);
        process.exit(2);
      }
      return createWalletClient({ account: privateKeyToAccount(k as Hex), chain, transport: http(rpc) });
    },
    close: async () => {},
  };
}

export const usdc = (u: bigint) => (Number(u) / 1e6).toFixed(4) + " USDC";
export const tx = (c: Ctx, h?: string) => (!h ? "—" : c.stack ? h : `${c.explorer}/tx/${h}`);
export const header = (c: Ctx, title: string) => console.log(`\n=== ${title} — ${c.label} ===\n`);
