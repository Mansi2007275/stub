/**
 * A second seller on Stub, built with @stub/paywall in ~20 lines: "Tagline Writer".
 *   npm run demo:paywall -- --local
 * Local mode registers service #2 on a throwaway chain, serves it with stubPaywall, and buys it with the SDK.
 */
import { createServer } from "node:http";
import { keccak256, stringToBytes } from "viem";
import { foundry } from "viem/chains";
import { escrowAbi } from "../shared/escrowAbi";
import { stubPaywall, ProviderError } from "../packages/paywall/src/index";
import { StubClient } from "../packages/sdk/src/index";
import { DEV_KEYS } from "../lib/dev/localStack";
import { header, isLocal, mockGenerate, setup, tx } from "./_env";

if (!isLocal) {
  console.log("Run with --local, or copy the stubPaywall() block into your own server (see packages/paywall/README.md).");
  process.exit(0);
}

const c = await setup();
header(c, "Second seller with @stub/paywall");
const s = c.stack!;
void mockGenerate;

// 1. The seller lists "Tagline Writer" at 0.02 USDC with its own gateway key.
const merchant = s.wallet("merchant");
await s.client.waitForTransactionReceipt({
  hash: await merchant.writeContract({ address: s.escrow, abi: escrowAbi, functionName: "registerService", args: [s.address("owner"), 20_000n, 300, keccak256(stringToBytes("stub:taglines:v1"))] }),
});
const serviceId = 2n;

// 2. The seller's whole integration:
const paywall = stubPaywall({
  escrow: s.escrow,
  serviceId,
  fulfillerKey: DEV_KEYS.owner,
  rpcUrl: s.rpc,
  chain: foundry,
  handler: async (input) => {
    if (input.length > 400) throw new ProviderError("input_too_long"); // → buyer refunded instantly
    const words = input.split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
    return { taglines: [`${words.join(" ")}, done right.`, `The simplest way to ${words[0] ?? "start"}.`, `Built for people who ${words[1] ?? "ship"}.`] };
  },
});

const port = 9400 + Math.floor(Math.random() * 400);
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(ch as Buffer);
  const r = await paywall.fetch(new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers as HeadersInit, body: Buffer.concat(chunks) }));
  res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" });
  res.end(await r.text());
});
await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));

// 3. Any buyer uses the same SDK, pointed at the seller's endpoint.
const buyer = new StubClient({ apiBase: `http://127.0.0.1:${port}/stub`, escrow: s.escrow, usdc: s.usdc, publicClient: s.client, walletClient: s.wallet("buyer") });
const before = await s.balance(s.address("merchant"));
const out = await buyer.buy<{ taglines: string[] }>({ serviceId, input: "rent idle camera gear to film students nearby" });
console.log("taglines:", out.result.taglines);
console.log(`released ${tx(c, out.fulfillTx)}`);
console.log(`seller earned ${(Number((await s.balance(s.address("merchant"))) - before) / 1e6).toFixed(4)} USDC (97% of 0.02)`);

server.close();
await c.close();
