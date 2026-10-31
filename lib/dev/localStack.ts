/**
 * LOCAL development stack: anvil chain + MockUSDC + StubEscrow + an HTTP gateway that runs
 * the exact same code as the Vercel functions (processQuote / processCall).
 * Everything here is LOCAL-CHAIN evidence only — never present it as testnet or mainnet.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as netServer } from "node:net";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToBytes,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { escrowAbi } from "../server/escrowAbi";
import { processCall, type Deps } from "../server/callCore";
import { processQuote } from "../server/quoteCore";
import { getFeed } from "../server/feedCore";
import { memoryStore, type Store } from "../server/store";
import type { Generate } from "../server/pitchBrief";

// anvil's public default dev keys — test-only, worthless on any real network
export const DEV_KEYS = {
  owner: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  merchant: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  fulfiller: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  buyer: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  agent: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  deckApp: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
} as const satisfies Record<string, Hex>;
export type Who = keyof typeof DEV_KEYS;

export const PRICE = 50_000n; // 0.05 USDC
const ROOT = resolve(import.meta.dirname ?? __dirname, "../..");
const art = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8")) as { abi: Abi; bytecode: { object: Hex } };

/** Asks the OS for a free TCP port, so parallel test suites never collide. */
export function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = netServer();
    srv.unref();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address();
      const port = typeof a === "object" && a ? a.port : 0;
      srv.close(() => res(port));
    });
  });
}

export type LocalStack = {
  rpc: string;
  apiBase: string;
  client: PublicClient;
  wallet: (w: Who) => WalletClient<Transport, Chain, Account>;
  address: (w: Who) => Address;
  escrow: Address;
  usdc: Address;
  usdcAbi: Abi;
  serviceId: bigint;
  store: Store;
  /** Replace the gateway's generator (e.g. to simulate a provider outage). */
  setGenerate: (g: Generate) => void;
  /** Rebuild gateway deps from scratch, keeping only the persistent store (simulates a process restart). */
  restartGateway: () => void;
  balance: (a: Address) => Promise<bigint>;
  stop: () => Promise<void>;
};

export async function startLocalStack(opts: {
  generate: Generate;
  anvilBin?: string;
  port?: number;
  apiPort?: number;
  store?: Store;
  /** Pass a specific chain id to anvil (e.g. Arc Testnet = 5042002). Defaults to foundry's 31337. */
  chainId?: number;
  /** Set Access-Control-Allow-Origin: * on the local HTTP gateway. */
  cors?: boolean;
}): Promise<LocalStack> {
  const port = opts.port ?? (await freePort());
  const rpc = `http://127.0.0.1:${port}`;
  const anvilArgs = ["--port", String(port), "--silent"];
  if (opts.chainId !== undefined) anvilArgs.push("--chain-id", String(opts.chainId));
  const anvil: ChildProcess = spawn(opts.anvilBin ?? process.env.ANVIL_BIN ?? "anvil", anvilArgs, { stdio: "ignore" });

  // Clients must sign for the chain id anvil actually runs (e.g. Arc Testnet's 5042002 in browser e2e).
  const chain: Chain = { ...foundry, id: opts.chainId ?? foundry.id };
  const client = createPublicClient({ chain, transport: http(rpc) }) as PublicClient;
  for (let i = 0; i < 80; i++) {
    try {
      await client.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const wallets = new Map<Who, WalletClient<Transport, Chain, Account>>();
  const wallet = (w: Who) => {
    if (!wallets.has(w)) wallets.set(w, createWalletClient({ account: privateKeyToAccount(DEV_KEYS[w]), chain, transport: http(rpc) }));
    return wallets.get(w)!;
  };
  const address = (w: Who) => wallet(w).account.address;
  const send = async (hash: Promise<Hex>) => client.waitForTransactionReceipt({ hash: await hash });

  const deploy = async (path: string, args: unknown[] = []) => {
    const a = art(path);
    const r = await send(wallet("owner").deployContract({ abi: a.abi, bytecode: a.bytecode.object, args }));
    return r.contractAddress as Address;
  };

  // Arc has the canonical Multicall3; a bare anvil doesn't. wagmi batches reads through it.
  const mc = await deploy("out/Multicall3.sol/Multicall3.json");
  const mcCode = await client.getCode({ address: mc });
  await client.request({ method: "anvil_setCode" as never, params: ["0xcA11bde05977b3631167028862bE2a173976CA11", mcCode] as never });

  const usdcAbi = art("out/MockUSDC.sol/MockUSDC.json").abi;
  const usdc = await deploy("out/MockUSDC.sol/MockUSDC.json");
  const escrow = await deploy("out/StubEscrow.sol/StubEscrow.json", [usdc, address("owner"), address("owner"), 300]);

  await send(
    wallet("merchant").writeContract({
      address: escrow,
      abi: escrowAbi,
      functionName: "registerService",
      args: [address("fulfiller"), PRICE, 600, keccak256(stringToBytes("stub:pitch-brief:v1"))],
    }),
  );
  for (const w of ["buyer", "deckApp"] as const) {
    await send(wallet("owner").writeContract({ address: usdc, abi: usdcAbi, functionName: "mint", args: [address(w), 10_000_000n] }));
  }

  const store = opts.store ?? memoryStore();
  let generate = opts.generate;
  const makeDeps = (): Deps => ({
    client,
    wallet: createWalletClient({ account: privateKeyToAccount(DEV_KEYS.fulfiller), chain, transport: http(rpc) }),
    escrow,
    serviceId: 1n,
    store,
    generate: (i, o) => generate(i, o),
  });
  let deps = makeDeps();

  const corsHeaders: Record<string, string> = opts.cors ? { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, accept", "access-control-allow-methods": "GET, POST, OPTIONS" } : {};
  const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...corsHeaders });
    res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  };
  const server: Server = createServer((req, res) => {
    if (opts.cors && req.method === "OPTIONS") return void res.writeHead(204, corsHeaders).end();
    let raw = "";
    req.on("data", (c: Buffer) => {
      raw += c.toString();
      if (raw.length > 8 * 1024) req.destroy();
    });
    req.on("end", () => {
      void (async () => {
        try {
          const body = raw ? (JSON.parse(raw) as unknown) : {};
          if (req.method === "POST" && req.url === "/api/quote") {
            const out = await processQuote(client, escrow, body);
            return json(res, out.status, out.body);
          }
          if (req.method === "POST" && req.url === "/api/call") {
            const out = await processCall(deps, body);
            return json(res, out.status, out.body);
          }
          if (req.method === "GET" && req.url === "/api/feed") {
            const doc = await getFeed(client, escrow, store, 0n, 50);
            return json(res, 200, doc);
          }
          json(res, 404, { error: "not_found" });
        } catch (e) {
          json(res, 500, { error: "internal_error", name: (e as Error).name });
        }
      })();
    });
  });
  const apiPort = opts.apiPort ?? (await freePort());
  await new Promise<void>((r) => server.listen(apiPort, "127.0.0.1", r));

  return {
    rpc,
    apiBase: `http://127.0.0.1:${apiPort}/api`,
    client,
    wallet,
    address,
    escrow,
    usdc,
    usdcAbi,
    serviceId: 1n,
    store,
    setGenerate: (g) => (generate = g),
    restartGateway: () => (deps = makeDeps()),
    balance: (a) => client.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [a] }) as Promise<bigint>,
    stop: async () => {
      await new Promise((r) => server.close(r));
      anvil.kill();
    },
  };
}
