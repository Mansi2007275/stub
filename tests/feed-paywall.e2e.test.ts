/** LOCAL-CHAIN evidence: event feed (chunked, incremental) and @stub/paywall as a second seller. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keccak256, stringToBytes, toHex, type Hex } from "viem";
import { foundry } from "viem/chains";
import { escrowAbi } from "../shared/escrowAbi";
import { advanceFeed, emptyDoc } from "../shared/feed";
import { callMessage, hashInput, type PitchBrief } from "../shared/protocol";
import { startLocalStack, DEV_KEYS, PRICE, type LocalStack } from "../lib/dev/localStack";
import { getFeed } from "../lib/server/feedCore";
import { memoryStore } from "../lib/server/store";
import { StubClient, StubError } from "../packages/sdk/src/index";
import { stubPaywall, ProviderError } from "../packages/paywall/src/index";

let s: LocalStack;
const brief = (i: string): PitchBrief => ({
  title: "t",
  oneLiner: i.slice(0, 20),
  problem: "p",
  customer: "c",
  solution: "s",
  market: "m",
  businessModel: "b",
  moat: "o",
  risks: ["r1", "r2"],
  slides: Array.from({ length: 5 }, (_, n) => ({ title: `S${n}`, bullets: ["a", "b"] })),
});
const idea = (t: string) => `${t} ${Math.random().toString(36).slice(2)} — a booking tool for community halls`;
const buyer = () => new StubClient({ apiBase: s.apiBase, escrow: s.escrow, usdc: s.usdc, publicClient: s.client, walletClient: s.wallet("buyer") });

beforeAll(async () => {
  s = await startLocalStack({ generate: async (i) => brief(i), anvilBin: process.env.ANVIL_BIN ?? "anvil" });
}, 60_000);
afterAll(async () => s?.stop());

describe("event feed", () => {
  let released: Hex, refunded: Hex, locked: Hex;

  beforeAll(async () => {
    released = (await buyer().buy({ serviceId: 1n, input: idea("rel") })).purchaseId;

    s.setGenerate(async () => {
      throw new ProviderError("gemini_http_500");
    });
    refunded = ((await buyer().buy({ serviceId: 1n, input: idea("ref") }).catch((e: StubError) => e)) as StubError).purchaseId!;
    s.setGenerate(async (i) => brief(i));

    locked = keccak256(toHex(`lock-${Math.random()}`));
    const w = s.wallet("buyer");
    await s.client.waitForTransactionReceipt({ hash: await w.writeContract({ address: s.usdc, abi: s.usdcAbi, functionName: "approve", args: [s.escrow, PRICE] }) });
    await s.client.waitForTransactionReceipt({
      hash: await w.writeContract({ address: s.escrow, abi: escrowAbi, functionName: "pay", args: [1n, locked, hashInput("held"), PRICE] }),
    });
  });

  it("reports each purchase with its final status and correct totals", async () => {
    const doc = await getFeed(s.client, s.escrow, memoryStore(), 0n, 50);
    const st = Object.fromEntries(doc.items.map((i) => [i.purchaseId, i.status]));
    expect(st[released]).toBe("Released");
    expect(st[refunded]).toBe("Refunded");
    expect(st[locked]).toBe("Locked");
    expect(doc.totals).toMatchObject({ purchases: 3, released: 1, refunded: 1, volumeReleased: PRICE.toString(), fees: ((PRICE * 300n) / 10_000n).toString() });
    expect(doc.items[0].purchaseId).toBe(locked); // newest first
  });

  it("tiny chunks over many calls give exactly the same result as one pass (no double counting)", async () => {
    const one = await advanceFeed(s.client, s.escrow, emptyDoc(0n, 31337), 1_000);
    let doc = emptyDoc(0n, 31337);
    for (let i = 0; i < 200 && BigInt(doc.cursor) < (await s.client.getBlockNumber()); i++) doc = await advanceFeed(s.client, s.escrow, doc, 1, 2n);
    expect(doc.totals).toEqual(one.totals);
    expect(doc.items.map((i) => [i.purchaseId, i.status])).toEqual(one.items.map((i) => [i.purchaseId, i.status]));
    const again = await advanceFeed(s.client, s.escrow, doc, 5);
    expect(again.totals).toEqual(one.totals); // re-running with no new blocks changes nothing
  });

  it("concurrent feed requests do not double count", async () => {
    const store = memoryStore();
    await Promise.all([getFeed(s.client, s.escrow, store, 0n, 50), getFeed(s.client, s.escrow, store, 0n, 50), getFeed(s.client, s.escrow, store, 0n, 50)]);
    const doc = await getFeed(s.client, s.escrow, store, 0n, 50);
    expect(doc.totals.purchases).toBe(3);
  });

  it("is served by the gateway at GET /api/feed", async () => {
    const r = await fetch(`${s.apiBase}/feed`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { totals: { purchases: number } };
    expect(body.totals.purchases).toBeGreaterThanOrEqual(3);
  });
});

describe("@stub/paywall — a second seller", () => {
  let paywall: ReturnType<typeof stubPaywall<{ taglines: string[] }>>;
  const serviceId = 2n;
  let fail = false;

  beforeAll(async () => {
    await s.client.waitForTransactionReceipt({
      hash: await s.wallet("merchant").writeContract({
        address: s.escrow,
        abi: escrowAbi,
        functionName: "registerService",
        args: [s.address("owner"), 20_000n, 300, keccak256(stringToBytes("stub:taglines:v1"))],
      }),
    });
    paywall = stubPaywall({
      escrow: s.escrow,
      serviceId,
      fulfillerKey: DEV_KEYS.owner,
      rpcUrl: s.rpc,
      chain: foundry,
      rateLimitPerMinute: 1000,
      handler: async (input) => {
        if (fail) throw new ProviderError("upstream_down");
        return { taglines: [`${input.slice(0, 12)}…`] };
      },
    });
  });

  const viaPaywall: typeof fetch = async (url, init) => paywall.fetch(new Request(String(url), init as RequestInit));
  const sdk = () => new StubClient({ apiBase: "http://seller.test/api/stub", escrow: s.escrow, usdc: s.usdc, publicClient: s.client, walletClient: s.wallet("buyer"), fetch: viaPaywall });

  it("sells its own service end to end and the seller is paid 97%", async () => {
    const before = await s.balance(s.address("merchant"));
    const out = await sdk().buy<{ taglines: string[] }>({ serviceId, input: idea("tag") });
    expect(out.result.taglines).toHaveLength(1);
    expect((await sdk().getPurchase(out.purchaseId)).status).toBe(2);
    expect((await s.balance(s.address("merchant"))) - before).toBe(19_400n);
  });

  it("refuses a purchase that was paid for a different service", async () => {
    const purchaseId = keccak256(toHex(`other-${Math.random()}`));
    const input = idea("other");
    const w = s.wallet("buyer");
    await s.client.waitForTransactionReceipt({ hash: await w.writeContract({ address: s.usdc, abi: s.usdcAbi, functionName: "approve", args: [s.escrow, PRICE] }) });
    await s.client.waitForTransactionReceipt({ hash: await w.writeContract({ address: s.escrow, abi: escrowAbi, functionName: "pay", args: [1n, purchaseId, hashInput(input), PRICE] }) });
    const signature = await w.signMessage({ message: callMessage(purchaseId, hashInput(input)) });
    const r = await paywall.call({ purchaseId, input, signature });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: "wrong_service" });
  });

  it("a throwing handler refunds the buyer in the same request", async () => {
    const before = await s.balance(s.address("buyer"));
    fail = true;
    await expect(sdk().buy({ serviceId, input: idea("down") })).rejects.toMatchObject({ code: "provider_failed" });
    fail = false;
    expect(await s.balance(s.address("buyer"))).toBe(before);
  });

  it("rejects oversized bodies and unknown routes", async () => {
    const big = await paywall.fetch(new Request("http://x/api/stub/call", { method: "POST", body: "x".repeat(9000) }));
    expect(big.status).toBe(413);
    const nf = await paywall.fetch(new Request("http://x/api/stub/nope", { method: "POST", body: "{}" }));
    expect(nf.status).toBe(404);
  });
});
