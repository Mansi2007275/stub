/**
 * LOCAL-CHAIN evidence (anvil). Real contract bytecode, real transactions, real signatures.
 * Only Gemini and Redis are replaced (fake generator + in-memory store). This is NOT testnet/mainnet evidence.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToBytes,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { escrowAbi } from "../lib/server/escrowAbi";
import { processCall, type Deps } from "../lib/server/callCore";
import { keys, memoryStore } from "../lib/server/store";
import { freePort } from "../lib/dev/localStack";
import { ProviderError } from "../lib/server/pitchBrief";
import { callMessage, hashInput, type PitchBrief } from "../shared/protocol";

let PORT = 0;
let RPC = "";
// anvil default dev keys (public, test-only)
const KEYS = {
  owner: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  merchant: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  fulfiller: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  buyer: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  stranger: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
} as const;
const acct = (k: keyof typeof KEYS) => privateKeyToAccount(KEYS[k]);
const PRICE = 50_000n; // 0.05 USDC
const IDEA = "A marketplace where small clinics rent idle MRI time to each other";

const brief: PitchBrief = {
  title: "ScanShare",
  oneLiner: "Idle MRI hours, booked like hotel rooms.",
  problem: "Clinics leave expensive scanners idle.",
  customer: "Independent imaging clinics.",
  solution: "A booking marketplace for spare scanner time.",
  market: "Size by counting independent clinics with MRI units.",
  businessModel: "Take rate per booked hour.",
  moat: "Two-sided liquidity in a region.",
  risks: ["Regulatory approvals", "Scheduling liability"],
  slides: Array.from({ length: 5 }, (_, i) => ({ title: `Slide ${i + 1}`, bullets: ["a", "b"] })),
};

let anvil: ChildProcess;
let client: PublicClient;
let escrow: Address;
let usdc: Address;
let generateCalls = 0;
let failNext = false;

const wallet = (k: keyof typeof KEYS) => createWalletClient({ account: acct(k), chain: foundry, transport: http(RPC) });
const art = (p: string) => JSON.parse(readFileSync(p, "utf8")) as { abi: unknown[]; bytecode: { object: Hex } };

async function deploy(k: keyof typeof KEYS, path: string, args: unknown[] = []) {
  const a = art(path);
  const hash = await wallet(k).deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
  const r = await client.waitForTransactionReceipt({ hash });
  return r.contractAddress as Address;
}
const usdcAbi = art("out/MockUSDC.sol/MockUSDC.json").abi;
const bal = (a: Address) => client.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [a] }) as Promise<bigint>;

function deps(overrides: Partial<Deps> = {}): Deps {
  return {
    client,
    wallet: wallet("fulfiller"),
    escrow,
    serviceId: 1n,
    store,
    generate: async () => {
      generateCalls++;
      if (failNext) {
        failNext = false;
        throw new ProviderError("gemini_http_500");
      }
      await new Promise((r) => setTimeout(r, 150));
      return brief;
    },
    ...overrides,
  };
}
const store = memoryStore();

async function buy(input = IDEA, who: keyof typeof KEYS = "buyer") {
  const purchaseId = keccak256(toHex(`${who}:${Math.random()}`));
  const hash = await wallet(who).writeContract({
    address: escrow,
    abi: escrowAbi,
    functionName: "pay",
    args: [1n, purchaseId, hashInput(input), PRICE],
  });
  await client.waitForTransactionReceipt({ hash });
  const signature = await wallet(who).signMessage({ message: callMessage(purchaseId, hashInput(input)) });
  return { purchaseId, signature };
}

beforeAll(async () => {
  PORT = await freePort();
  RPC = `http://127.0.0.1:${PORT}`;
  anvil = spawn(process.env.ANVIL_BIN ?? "anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  client = createPublicClient({ chain: foundry, transport: http(RPC) }) as PublicClient;
  for (let i = 0; i < 50; i++) {
    try {
      await client.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  usdc = await deploy("owner", "out/MockUSDC.sol/MockUSDC.json");
  escrow = await deploy("owner", "out/StubEscrow.sol/StubEscrow.json", [usdc, acct("owner").address, acct("owner").address, 300]);

  const m = wallet("merchant");
  await client.waitForTransactionReceipt({
    hash: await m.writeContract({ address: escrow, abi: escrowAbi, functionName: "registerService", args: [acct("fulfiller").address, PRICE, 600, keccak256(stringToBytes("stub:pitch-brief:v1"))] }),
  });
  for (const who of ["buyer", "stranger"] as const) {
    await client.waitForTransactionReceipt({ hash: await wallet("owner").writeContract({ address: usdc, abi: usdcAbi, functionName: "mint", args: [acct(who).address, 10_000_000n] }) });
    await client.waitForTransactionReceipt({
      hash: await wallet(who).writeContract({ address: usdc, abi: usdcAbi, functionName: "approve", args: [escrow, 2n ** 255n] }),
    });
  }
}, 60_000);

afterAll(() => anvil?.kill());

describe("Stub gateway — local chain", () => {
  it("denies an unpaid purchase", async () => {
    const purchaseId = keccak256(toHex("never-paid"));
    const signature = await wallet("buyer").signMessage({ message: callMessage(purchaseId, hashInput(IDEA)) });
    const out = await processCall(deps(), { purchaseId, input: IDEA, signature });
    expect(out.status).toBe(402);
  });

  it("rejects malformed bodies", async () => {
    expect((await processCall(deps(), { purchaseId: "0x12", input: "short", signature: "0x" })).status).toBe(400);
  });

  it("rejects a stranger's signature on someone else's purchase", async () => {
    const { purchaseId } = await buy();
    const signature = await wallet("stranger").signMessage({ message: callMessage(purchaseId, hashInput(IDEA)) });
    const out = await processCall(deps(), { purchaseId, input: IDEA, signature });
    expect(out.status).toBe(401);
  });

  it("rejects input that differs from the paid input hash", async () => {
    const { purchaseId, signature } = await buy();
    const out = await processCall(deps(), { purchaseId, input: IDEA + " but cheaper", signature });
    expect(out.status).toBe(403);
    expect(out.body).toMatchObject({ error: "input_mismatch" });
  });

  it("rejects a purchase for a different service id", async () => {
    const { purchaseId, signature } = await buy();
    const out = await processCall(deps({ serviceId: 2n }), { purchaseId, input: IDEA, signature });
    expect(out.status).toBe(403);
  });

  it("delivers, releases escrow with the result hash, and splits 97/3", async () => {
    const merchant0 = await bal(acct("merchant").address);
    const { purchaseId, signature } = await buy();
    const out = await processCall(deps(), { purchaseId, input: IDEA, signature });
    expect(out.status).toBe(200);
    if (!out.body.ok) throw new Error("expected ok");

    const p = await client.readContract({ address: escrow, abi: escrowAbi, functionName: "getPurchase", args: [purchaseId] });
    expect(p.status).toBe(2); // Fulfilled
    expect(p.resultHash).toBe(out.body.resultHash);
    expect((await bal(acct("merchant").address)) - merchant0).toBe(48_500n);
  });

  it("a retry after a lost response returns the same result and never charges again", async () => {
    const { purchaseId, signature } = await buy();
    const first = await processCall(deps(), { purchaseId, input: IDEA, signature });
    const buyerAfterFirst = await bal(acct("buyer").address);
    const callsBefore = generateCalls;

    const retry = await processCall(deps(), { purchaseId, input: IDEA, signature });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ ok: true, cached: true });
    expect(retry.body.ok && first.body.ok && retry.body.resultHash === first.body.resultHash).toBe(true);
    expect(generateCalls).toBe(callsBefore); // provider not called again
    expect(await bal(acct("buyer").address)).toBe(buyerAfterFirst); // no second charge
  });

  it("concurrent duplicate requests cannot double-run or double-fulfil", async () => {
    const { purchaseId, signature } = await buy();
    const before = generateCalls;
    const [a, b] = await Promise.all([
      processCall(deps(), { purchaseId, input: IDEA, signature }),
      processCall(deps(), { purchaseId, input: IDEA, signature }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(generateCalls - before).toBe(1);
  });

  it("refunds immediately when the provider fails", async () => {
    const start = await bal(acct("buyer").address);
    const { purchaseId, signature } = await buy();
    expect(await bal(acct("buyer").address)).toBe(start - PRICE);

    failNext = true;
    const out = await processCall(deps(), { purchaseId, input: IDEA, signature });
    expect(out.status).toBe(502);
    expect(out.body).toMatchObject({ ok: false, refunded: true });
    expect(await bal(acct("buyer").address)).toBe(start);

    const again = await processCall(deps(), { purchaseId, input: IDEA, signature });
    expect(again.status).toBe(409); // refunded, nothing more to do
  });

  it("refuses to start work when the deadline is too close", async () => {
    const { purchaseId, signature } = await buy();
    const out = await processCall(deps({ now: () => Math.floor(Date.now() / 1000) + 10_000 }), { purchaseId, input: IDEA, signature });
    expect(out.status).toBe(410);
  });

  it("an agent with a budget can buy; its signature is accepted", async () => {
    await client.waitForTransactionReceipt({
      hash: await wallet("buyer").writeContract({ address: escrow, abi: escrowAbi, functionName: "setAgentBudget", args: [acct("stranger").address, PRICE, PRICE * 2n, true] }),
    });
    const purchaseId = keccak256(toHex("agent-buy"));
    await client.waitForTransactionReceipt({
      hash: await wallet("stranger").writeContract({ address: escrow, abi: escrowAbi, functionName: "payAsAgent", args: [acct("buyer").address, 1n, purchaseId, hashInput(IDEA), PRICE] }),
    });
    const signature = await wallet("stranger").signMessage({ message: callMessage(purchaseId, hashInput(IDEA)) });
    const out = await processCall(deps(), { purchaseId, input: IDEA, signature });
    expect(out.status).toBe(200);
  });
});

/**
 * Regression cover for the two documented launch blockers:
 *  1. generation + fulfil confirmation could exceed /api/call's 60s function limit;
 *  2. the early-refund path waited on a receipt with no bound, unlike the fulfil path.
 * Both now run against one request budget and settle against on-chain purchase state, so an
 * unknown transaction is reported as pending - never as failed, and never as a completed refund.
 */
describe("Stub gateway - bounded request budget and settlement reporting", () => {
  /** A client whose actions can be selectively replaced. viem clients are plain objects. */
  const lagging = (over: Record<string, unknown>): PublicClient => ({ ...client, ...over }) as unknown as PublicClient;
  /** Arc leaves eth_getTransactionReceipt null for minutes after the block. */
  const receiptNeverIndexed = {
    getTransactionReceipt: async () => {
      throw new Error("receipt not indexed yet");
    },
  };
  /** The escrow read also cannot see the settlement yet, so the outcome is genuinely unknown. */
  const statusStuckLocked = {
    readContract: async (a: { functionName: string }) =>
      a.functionName === "statusOf" ? 1 : await client.readContract(a as Parameters<PublicClient["readContract"]>[0]),
  };

  it("bounds a hung purchase RPC without invoking the provider", async () => {
    const { purchaseId, signature } = await buy();
    const before = generateCalls;
    const started = Date.now();
    const out = await processCall(deps({ requestBudgetMs: 1_800, client: lagging({ readContract: () => new Promise(() => {}) }) }), { purchaseId, input: IDEA, signature });
    expect(out.body).toMatchObject({ error: "no_time_left" });
    expect(Date.now() - started).toBeLessThan(1_800);
    expect(generateCalls).toBe(before);
  });

  it("bounds a hung Redis read without invoking the provider", async () => {
    const { purchaseId, signature } = await buy();
    const before = generateCalls;
    const started = Date.now();
    const out = await processCall(deps({ requestBudgetMs: 1_800, store: { ...store, get: () => new Promise(() => {}) } }), { purchaseId, input: IDEA, signature });
    expect(out.body).toMatchObject({ error: "no_time_left" });
    expect(Date.now() - started).toBeLessThan(1_800);
    expect(generateCalls).toBe(before);
  });

  it("reports an authorization RPC deadline as retryable rather than a bad signature", async () => {
    const { purchaseId, signature } = await buy();
    const before = generateCalls;
    const out = await processCall(deps({ requestBudgetMs: 1_800, client: lagging({ verifyMessage: () => new Promise(() => {}) }) }), { purchaseId, input: IDEA, signature });
    expect(out.status).toBe(503);
    expect(out.body).toMatchObject({ error: "no_time_left" });
    expect(generateCalls).toBe(before);
  });

  it("bounds a hung confirmation RPC and reports pending", async () => {
    const { purchaseId, signature } = await buy();
    const out = await processCall(deps({ confirmBudgetMs: 50, client: lagging({
      readContract: (a: { functionName: string }) => a.functionName === "statusOf" ? new Promise(() => {}) : client.readContract(a as Parameters<PublicClient["readContract"]>[0]),
    }) }), { purchaseId, input: IDEA, signature });
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ error: "fulfill_pending", pending: true });
  });

  it("never blindly rebroadcasts after a send loses its response", async () => {
    const { purchaseId, signature } = await buy();
    let sends = 0;
    const before = generateCalls;
    const uncertainWallet = { ...wallet("fulfiller"), writeContract: async () => { sends++; throw new Error("connection lost after submission"); } } as Deps["wallet"];
    const buyerBefore = await bal(acct("buyer").address);
    const first = await processCall(deps({ wallet: uncertainWallet }), { purchaseId, input: IDEA, signature });
    const again = await processCall(deps({ wallet: uncertainWallet }), { purchaseId, input: IDEA, signature });
    expect(first.body).toMatchObject({ error: "fulfill_pending", pending: true });
    expect(again.body).toMatchObject({ error: "fulfill_pending", pending: true });
    expect(sends).toBe(1);
    expect(generateCalls - before).toBe(1);
    expect(await bal(acct("buyer").address)).toBe(buyerBefore);
  });

  it("retains a failed-provider outcome across retries without regenerating", async () => {
    const { purchaseId, signature } = await buy();
    let sends = 0;
    const before = generateCalls;
    failNext = true;
    const uncertainWallet = { ...wallet("fulfiller"), writeContract: async () => { sends++; throw new Error("response lost"); } } as Deps["wallet"];
    const first = await processCall(deps({ wallet: uncertainWallet }), { purchaseId, input: IDEA, signature });
    const again = await processCall(deps({ wallet: uncertainWallet }), { purchaseId, input: IDEA, signature });
    expect(first.body).toMatchObject({ error: "refund_pending", pending: true });
    expect(again.body).toMatchObject({ error: "refund_pending", pending: true });
    expect(sends).toBe(1);
    expect(generateCalls - before).toBe(1);
    // If a previous worker failed before broadcasting, the saved failure still takes the refund path.
    await store.del(keys.settlement(purchaseId));
    const recovered = await processCall(deps(), { purchaseId, input: IDEA, signature });
    expect(recovered.body).toMatchObject({ refunded: true });
    expect(generateCalls - before).toBe(1);
  });

  it("confirms a fulfil from the escrow when the receipt is never indexed", async () => {
    const { purchaseId, signature } = await buy();
    const out = await processCall(deps({ client: lagging(receiptNeverIndexed) }), { purchaseId, input: IDEA, signature });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, cached: false });
    const p = await client.readContract({ address: escrow, abi: escrowAbi, functionName: "getPurchase", args: [purchaseId] });
    expect(p.status).toBe(2);
  });

  it("reports an unconfirmable fulfil as pending, not failed, and the retry delivers the stored result", async () => {
    const { purchaseId, signature } = await buy();
    const before = generateCalls;
    const out = await processCall(deps({ client: lagging({ ...receiptNeverIndexed, ...statusStuckLocked }), confirmBudgetMs: 1_200 }), {
      purchaseId,
      input: IDEA,
      signature,
    });
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ ok: false, error: "fulfill_pending", pending: true });
    if (out.body.ok) throw new Error("expected pending");
    expect(out.body.refunded).toBeUndefined(); // nothing was refunded
    expect(out.body.fulfillTx).toBeDefined();

    // The release did land; the escrow is the authority. A retry returns the same result, unpaid.
    const buyerBefore = await bal(acct("buyer").address);
    const retry = await processCall(deps(), { purchaseId, input: IDEA, signature });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ ok: true, cached: true });
    expect(retry.body.ok && retry.body.resultHash).toBe(out.body.resultHash);
    expect(generateCalls - before).toBe(1); // the provider ran once
    expect(await bal(acct("buyer").address)).toBe(buyerBefore); // and was never charged twice
  });

  it("confirms an early refund from the escrow when the receipt is never indexed", async () => {
    const start = await bal(acct("buyer").address);
    const { purchaseId, signature } = await buy();
    failNext = true;
    const out = await processCall(deps({ client: lagging(receiptNeverIndexed) }), { purchaseId, input: IDEA, signature });
    expect(out.status).toBe(502);
    expect(out.body).toMatchObject({ ok: false, error: "provider_failed", refunded: true });
    expect(await bal(acct("buyer").address)).toBe(start);
  });

  it("reports an unconfirmable early refund as pending and never as refunded", async () => {
    const { purchaseId, signature } = await buy();
    failNext = true;
    const out = await processCall(
      deps({ client: lagging({ ...receiptNeverIndexed, ...statusStuckLocked }), confirmBudgetMs: 1_200 }),
      { purchaseId, input: IDEA, signature },
    );
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ ok: false, error: "refund_pending", pending: true });
    if (out.body.ok) throw new Error("expected pending");
    expect(out.body.refunded).toBeUndefined();
    expect(out.body.refundTx).toBeDefined();

    // It did land on-chain, so the next read settles it as refunded rather than claiming it early.
    const again = await processCall(deps(), { purchaseId, input: IDEA, signature });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: "refunded", refunded: true });
  });

  it("bounds generation by the remaining request budget and refunds instead of overrunning", async () => {
    const start = await bal(acct("buyer").address);
    const { purchaseId, signature } = await buy();
    const started = Date.now();
    const out = await processCall(
      // 24s budget - 18s settlement reserve leaves generation ~6s, well inside the 60s limit.
      deps({ requestBudgetMs: 24_000, generate: () => new Promise(() => {}) }),
      { purchaseId, input: IDEA, signature },
    );
    expect(Date.now() - started).toBeLessThan(24_000);
    expect(out.status).toBe(502);
    expect(out.body).toMatchObject({ ok: false, error: "provider_failed", refunded: true, detail: "provider_timeout" });
    expect(await bal(acct("buyer").address)).toBe(start);
  });

  it("passes the remaining budget to the generator so it can abort itself first", async () => {
    const { purchaseId, signature } = await buy();
    let hint: number | undefined;
    const out = await processCall(
      deps({
        requestBudgetMs: 30_000,
        generate: async (_i, o) => {
          hint = o?.timeoutMs;
          return brief;
        },
      }),
      { purchaseId, input: IDEA, signature },
    );
    expect(out.status).toBe(200);
    expect(hint).toBeGreaterThan(0);
    expect(hint).toBeLessThanOrEqual(30_000 - 18_000); // request budget minus the settlement reserve
  });

  it("will not start work when too little budget is left to settle, and leaves the purchase recoverable", async () => {
    const { purchaseId, signature } = await buy();
    const before = generateCalls;
    const out = await processCall(deps({ requestBudgetMs: 19_000 }), { purchaseId, input: IDEA, signature });
    expect(out.status).toBe(503);
    expect(out.body).toMatchObject({ ok: false, error: "no_time_left" });
    if (out.body.ok) throw new Error("expected failure");
    expect(out.body.refunded).toBeUndefined();
    expect(generateCalls).toBe(before); // nothing was spent on the provider
    const p = await client.readContract({ address: escrow, abi: escrowAbi, functionName: "getPurchase", args: [purchaseId] });
    expect(p.status).toBe(1); // still Locked: the same purchase can be retried

    const retry = await processCall(deps(), { purchaseId, input: IDEA, signature });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ ok: true, cached: false });
  });
});
