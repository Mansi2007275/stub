/**
 * LOCAL-CHAIN evidence: SDK, Deck Builder consumer, restart recovery and secret hygiene.
 * Real contract, real transactions, real HTTP gateway (same code as the Vercel functions).
 * Only the AI provider is a deterministic fake. Not testnet or mainnet evidence.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keccak256, parseUnits, stringToBytes, toHex, type Hex } from "viem";
import { escrowAbi } from "../shared/escrowAbi";
import { hashInput, type PitchBrief } from "../shared/protocol";
import { startLocalStack, DEV_KEYS, PRICE, type LocalStack } from "../lib/dev/localStack";
import { StubClient, StubError, memoryPending, type PendingStore } from "../packages/sdk/src/index";
import { canonicalJson, ProviderError } from "../lib/server/pitchBrief";
import { keys } from "../lib/server/store";
import { processCall } from "../lib/server/callCore";
import { createDeckBuilder, memoryJobs, templateDeck } from "../apps/deck-builder/src/deck";

let s: LocalStack;
let generateCalls = 0;
const brief = (idea: string): PitchBrief => ({
  title: `Brief for ${idea.slice(0, 20)}`,
  oneLiner: `One-liner ${idea.length}`,
  problem: `PROBLEM-MARKER ${idea.slice(0, 30)}`,
  customer: "CUSTOMER-MARKER",
  solution: "SOLUTION-MARKER",
  market: "MARKET-MARKER",
  businessModel: "MODEL-MARKER",
  moat: "MOAT-MARKER",
  risks: ["RISK-A", "RISK-B"],
  slides: Array.from({ length: 5 }, (_, i) => ({ title: `S${i}`, bullets: ["x", "y"] })),
});
const goodGenerate = async (idea: string) => {
  generateCalls++;
  return brief(idea);
};
const idea = (tag: string) => `${tag} — ${Math.random().toString(36).slice(2)} a marketplace for idle lab equipment`;

const client = (opts: { who?: "buyer" | "agent"; pending?: PendingStore; fetch?: typeof fetch; agentOf?: `0x${string}`; retries?: number } = {}) =>
  new StubClient({
    apiBase: s.apiBase,
    escrow: s.escrow,
    usdc: s.usdc,
    publicClient: s.client,
    walletClient: s.wallet(opts.who ?? "buyer"),
    pending: opts.pending,
    fetch: opts.fetch,
    agentOf: opts.agentOf,
    retries: opts.retries,
  });

beforeAll(async () => {
  s = await startLocalStack({ generate: goodGenerate, anvilBin: process.env.ANVIL_BIN ?? "anvil" });
}, 60_000);
afterAll(async () => s?.stop());

describe("SDK — standalone buyer (Demo A)", () => {
  it("buys, gets a real result, and the escrow shows it released", async () => {
    const before = await s.balance(s.address("buyer"));
    const out = await client().buy({ serviceId: 1n, input: idea("demoA") });
    const p = await client().getPurchase(out.purchaseId);
    expect(p.status).toBe(2);
    expect(p.resultHash).toBe(out.resultHash);
    expect(out.resultHash).toBe(keccak256(stringToBytes(canonicalJson(out.result))));
    expect(before - (await s.balance(s.address("buyer")))).toBe(PRICE);
  });

  it("refuses a quote above maxPrice without paying", async () => {
    const before = await s.balance(s.address("buyer"));
    await expect(client().buy({ serviceId: 1n, input: idea("max"), maxPrice: PRICE - 1n })).rejects.toMatchObject({ code: "price_above_max" });
    expect(await s.balance(s.address("buyer"))).toBe(before);
  });
});

describe("SDK — never charges twice (Demo C, test #7)", () => {
  it("lost response after payment: retry resumes the same purchase", async () => {
    const pending = memoryPending();
    const input = idea("lost");
    const broken: typeof fetch = async (url, init) => {
      if (String(url).endsWith("/call")) throw new TypeError("network down");
      return fetch(url, init);
    };
    const before = await s.balance(s.address("buyer"));
    await expect(client({ pending, fetch: broken, retries: 1 }).buy({ serviceId: 1n, input })).rejects.toBeInstanceOf(StubError);
    const afterFirst = await s.balance(s.address("buyer"));
    expect(before - afterFirst).toBe(PRICE);

    const out = await client({ pending }).buy({ serviceId: 1n, input });
    expect(out.resumed).toBe(true);
    expect(await s.balance(s.address("buyer"))).toBe(afterFirst);
  });

  it("crash after recording the id but before the pay tx: retry reuses the SAME id (contract makes double pay impossible)", async () => {
    const pending = memoryPending();
    const input = idea("crash");
    const k = `${s.address("buyer").toLowerCase()}:1:${hashInput(input)}`;
    const purchaseId = keccak256(toHex(`pre-${Math.random()}`)) as Hex;
    await pending.set(k, { purchaseId, serviceId: "1", inputHash: hashInput(input), createdAt: Date.now() });

    const before = await s.balance(s.address("buyer"));
    const out = await client({ pending }).buy({ serviceId: 1n, input });
    expect(out.purchaseId).toBe(purchaseId);
    expect(before - (await s.balance(s.address("buyer")))).toBe(PRICE);
  });

  it("pay tx landed but its hash was never saved: retry detects the lock and does not pay again", async () => {
    const pending = memoryPending();
    const input = idea("landed");
    const purchaseId = keccak256(toHex(`landed-${Math.random()}`)) as Hex;
    const w = s.wallet("buyer");
    await s.client.waitForTransactionReceipt({
      hash: await w.writeContract({ address: s.usdc, abi: s.usdcAbi, functionName: "approve", args: [s.escrow, PRICE] }),
    });
    await s.client.waitForTransactionReceipt({
      hash: await w.writeContract({ address: s.escrow, abi: escrowAbi, functionName: "pay", args: [1n, purchaseId, hashInput(input), PRICE] }),
    });
    await pending.set(`${s.address("buyer").toLowerCase()}:1:${hashInput(input)}`, { purchaseId, serviceId: "1", inputHash: hashInput(input), createdAt: Date.now() });

    const before = await s.balance(s.address("buyer"));
    const out = await client({ pending }).buy({ serviceId: 1n, input });
    expect(out.resumed).toBe(true);
    expect(await s.balance(s.address("buyer"))).toBe(before);
  });

  it("provider failure refunds the buyer immediately and is recorded", async () => {
    s.setGenerate(async () => {
      throw new ProviderError("gemini_http_503");
    });
    const before = await s.balance(s.address("buyer"));
    const err = await client().buy({ serviceId: 1n, input: idea("outage") }).catch((e: StubError) => e);
    expect(err).toBeInstanceOf(StubError);
    expect((err as StubError).code).toBe("provider_failed");
    expect(await s.balance(s.address("buyer"))).toBe(before);
    const failedKey = keys.failed((err as StubError).purchaseId!);
    expect(await s.store.get(failedKey)).toBe("gemini_http_503");
    s.setGenerate(goodGenerate);
  });
});

describe("SDK — agent budget", () => {
  it("agent buys within its caps, is stopped by OverDailyCap, and spends the owner's USDC", async () => {
    const owner = s.wallet("buyer");
    const agent = s.address("agent");
    const w = async (h: Promise<Hex>) => s.client.waitForTransactionReceipt({ hash: await h });
    await w(owner.writeContract({ address: s.escrow, abi: escrowAbi, functionName: "setAgentBudget", args: [agent, PRICE, PRICE * 2n, true] }));
    await w(owner.writeContract({ address: s.usdc, abi: s.usdcAbi, functionName: "approve", args: [s.escrow, PRICE * 2n] }));

    const a = client({ who: "agent", agentOf: s.address("buyer") });
    const ownerBefore = await s.balance(s.address("buyer"));
    await a.buy({ serviceId: 1n, input: idea("agent1") });
    await a.buy({ serviceId: 1n, input: idea("agent2") });
    await expect(a.buy({ serviceId: 1n, input: idea("agent3") })).rejects.toMatchObject({ code: "OverDailyCap" });
    expect(ownerBefore - (await s.balance(s.address("buyer")))).toBe(PRICE * 2n);
    expect(await s.balance(agent)).toBe(0n);
  });
});

describe("Gateway restart (test #8)", () => {
  it("after a restart, a finished purchase returns the stored result without re-running", async () => {
    const input = idea("restart");
    const out = await client().buy({ serviceId: 1n, input });
    s.restartGateway();
    const calls = generateCalls;
    const again = await client().collect(out.purchaseId, input);
    expect(again.cached).toBe(true);
    expect(again.resultHash).toBe(out.resultHash);
    expect(generateCalls).toBe(calls);
  });

  it("crash after storing the result but before fulfil: the restarted gateway releases without regenerating", async () => {
    const input = idea("half");
    const purchaseId = keccak256(toHex(`half-${Math.random()}`)) as Hex;
    const w = s.wallet("buyer");
    await s.client.waitForTransactionReceipt({ hash: await w.writeContract({ address: s.usdc, abi: s.usdcAbi, functionName: "approve", args: [s.escrow, PRICE] }) });
    await s.client.waitForTransactionReceipt({
      hash: await w.writeContract({ address: s.escrow, abi: escrowAbi, functionName: "pay", args: [1n, purchaseId, hashInput(input), PRICE] }),
    });
    const stored = canonicalJson(brief(input));
    await s.store.set(keys.result(purchaseId), stored); // what the crashed process had persisted

    s.restartGateway();
    const calls = generateCalls;
    const out = await client().collect(purchaseId, input);
    expect(generateCalls).toBe(calls);
    expect(out.resultHash).toBe(keccak256(stringToBytes(stored)));
    expect((await client().getPurchase(purchaseId)).status).toBe(2);
  });
});

describe("Deck Builder consumer (tests #10, #11)", () => {
  const ownerKey = "deckApp" as const;
  beforeAll(async () => {
    const owner = s.wallet(ownerKey);
    const w = async (h: Promise<Hex>) => s.client.waitForTransactionReceipt({ hash: await h });
    await w(owner.writeContract({ address: s.escrow, abi: escrowAbi, functionName: "setAgentBudget", args: [s.address("agent"), parseUnits("0.1", 6), parseUnits("1", 6), true] }));
    await w(owner.writeContract({ address: s.usdc, abi: s.usdcAbi, functionName: "approve", args: [s.escrow, parseUnits("1", 6)] }));
  });

  it("buys a real brief and the deck is built from it, with purchase evidence on the job", async () => {
    const stub = client({ who: "agent", agentOf: s.address(ownerKey) });
    const builder = createDeckBuilder({ jobs: memoryJobs(), generate: templateDeck, useStub: true, stub });
    const input = idea("deck");
    const job = await builder.run("job-1", input);

    expect(job.status).toBe("done");
    const text = JSON.stringify(job.deck);
    for (const m of ["PROBLEM-MARKER", "CUSTOMER-MARKER", "SOLUTION-MARKER", "MOAT-MARKER", "RISK-A"]) expect(text).toContain(m);

    const p = await client().getPurchase(job.stub!.purchaseId);
    expect(p.status).toBe(2);
    expect(p.resultHash).toBe(job.stub!.resultHash);
    expect(p.payer.toLowerCase()).toBe(s.address(ownerKey).toLowerCase());
    expect(job.stub!.fulfillTx).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("the purchased brief is what the deck generator receives", async () => {
    let seen: PitchBrief | null | undefined;
    const builder = createDeckBuilder({
      jobs: memoryJobs(),
      generate: async (i, b) => ((seen = b), templateDeck(i, b)),
      useStub: true,
      stub: client({ who: "agent", agentOf: s.address(ownerKey) }),
    });
    const job = await builder.run("job-2", idea("gen"));
    expect(seen).toEqual(job.stub!.brief);
  });

  it("re-running the same job never buys twice", async () => {
    const jobs = memoryJobs();
    const builder = createDeckBuilder({ jobs, generate: templateDeck, useStub: true, stub: client({ who: "agent", agentOf: s.address(ownerKey) }) });
    const input = idea("idem");
    const before = await s.balance(s.address(ownerKey));
    await builder.run("job-3", input);
    await builder.run("job-3", input);
    expect(before - (await s.balance(s.address(ownerKey)))).toBe(PRICE);
  });

  it("with the feature flag off it still builds a deck and moves no USDC", async () => {
    const before = await s.balance(s.address(ownerKey));
    const blockNo = await s.client.getBlockNumber();
    const builder = createDeckBuilder({ jobs: memoryJobs(), generate: templateDeck, useStub: false });
    const job = await builder.run("job-4", idea("off"));
    expect(job.status).toBe("done");
    expect(job.stub).toBeUndefined();
    expect(await s.balance(s.address(ownerKey))).toBe(before);
    expect(await s.client.getBlockNumber()).toBe(blockNo);
  });

  it("a Stub failure fails the job cleanly instead of producing a fake deck", async () => {
    s.setGenerate(async () => {
      throw new ProviderError("gemini_timeout");
    });
    const builder = createDeckBuilder({ jobs: memoryJobs(), generate: templateDeck, useStub: true, stub: client({ who: "agent", agentOf: s.address(ownerKey) }) });
    const job = await builder.run("job-5", idea("fail"));
    expect(job.status).toBe("failed");
    expect(job.error).toBe("provider_failed");
    expect(job.deck).toBeUndefined();
    s.setGenerate(goodGenerate);
  });
});

describe("No secrets in responses, logs or the browser bundle (test #12)", () => {
  const SECRETS = [DEV_KEYS.fulfiller, DEV_KEYS.fulfiller.slice(2)];

  it("gateway responses never contain the fulfiller key", async () => {
    const outs: unknown[] = [];
    const deps = {
      client: s.client,
      wallet: s.wallet("fulfiller"),
      escrow: s.escrow,
      serviceId: 1n,
      store: s.store,
      generate: goodGenerate,
    };
    outs.push(await processCall(deps as never, { purchaseId: "0x01", input: "x", signature: "0x" }));
    outs.push(await processCall(deps as never, { purchaseId: keccak256(toHex("nope")), input: idea("x"), signature: "0x1234" }));
    const text = JSON.stringify(outs);
    for (const k of SECRETS) expect(text.toLowerCase()).not.toContain(k.toLowerCase());
  });

  it("config errors name the missing variable, never its value", async () => {
    const { secretEnv, ConfigError } = await import("../lib/server/env");
    const saved = { ...process.env };
    process.env.FULFILLER_PRIVATE_KEY = "0xdeadbeef-not-a-valid-key-SECRETVALUE";
    process.env.GEMINI_API_KEY = "AIza-SECRETVALUE-123";
    delete process.env.UPSTASH_REDIS_REST_URL;
    try {
      secretEnv();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as Error).message).toContain("FULFILLER_PRIVATE_KEY");
      expect((e as Error).message).not.toContain("SECRETVALUE");
    } finally {
      process.env = saved;
    }
  });

  it("the built browser bundle references no server-only secret names", () => {
    if (!existsSync("dist/assets")) return; // run `npm run build` first to include this check
    const js = readdirSync("dist/assets").filter((f) => f.endsWith(".js")).map((f) => readFileSync(`dist/assets/${f}`, "utf8")).join("\n");
    for (const name of ["FULFILLER_PRIVATE_KEY", "GEMINI_API_KEY", "UPSTASH_REDIS_REST_TOKEN", "ARC_STUDIO_TOKEN"]) expect(js).not.toContain(name);
    expect(js).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
  });
});
