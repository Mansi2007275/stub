/**
 * Demo C — failure safety.
 *  1. An unpaid request is refused.
 *  2. A paid request whose response is "lost" is retried with the same input: same purchase, no second charge.
 *  3. (local only) the provider fails: the buyer is refunded immediately.
 */
import { erc20Abi, keccak256, toHex } from "viem";
import { StubClient, StubError, callMessage, hashInput, memoryPending } from "../packages/sdk/src/index";
import { ProviderError } from "../lib/server/pitchBrief";
import { header, mockGenerate, setup, usdc } from "./_env";

const c = await setup();
header(c, "Demo C: failure safety");
const wallet = c.wallet("buyer");
const bal = () => c.publicClient.readContract({ address: c.usdc, abi: erc20Abi, functionName: "balanceOf", args: [wallet.account.address] });

// 1. Unpaid
const fakeId = keccak256(toHex(`unpaid-${Date.now()}`));
const idea1 = "Unpaid request: should never be served by the gateway";
const signature = await wallet.signMessage({ message: callMessage(fakeId, hashInput(idea1)) });
const r = await fetch(`${c.apiBase}/call`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purchaseId: fakeId, input: idea1, signature }) });
console.log(`1. unpaid request         → HTTP ${r.status} ${(await r.json() as { error?: string }).error}`);

// 2. Lost response, then retry
const pending = memoryPending(); // the SDK's crash-safe memory of in-flight purchases
const dropFirstCall: typeof fetch = (() => {
  let dropped = false;
  return async (url, init) => {
    const res = await fetch(url, init);
    if (!dropped && String(url).endsWith("/call")) {
      dropped = true;
      await res.text();
      throw new TypeError("simulated network drop after the gateway answered");
    }
    return res;
  };
})();
const idea2 = `Lost-response test ${Date.now()}: carbon credits for rooftop gardens`;
const before = await bal();
const flaky = new StubClient({ apiBase: c.apiBase, escrow: c.escrow, usdc: c.usdc, publicClient: c.publicClient, walletClient: wallet, pending, fetch: dropFirstCall, retries: 1 });
try {
  await flaky.buy({ serviceId: c.serviceId, input: idea2 });
} catch (e) {
  console.log(`2a. first attempt         → ${(e as StubError).code} (response lost after payment)`);
}
const afterFirst = await bal();
const steady = new StubClient({ apiBase: c.apiBase, escrow: c.escrow, usdc: c.usdc, publicClient: c.publicClient, walletClient: wallet, pending });
const again = await steady.buy({ serviceId: c.serviceId, input: idea2 });
const afterRetry = await bal();
console.log(`2b. retry same input      → ok, resumed=${again.resumed}, cached=${again.cached}, purchase ${again.purchaseId.slice(0, 10)}…`);
console.log(`    charged first attempt ${usdc(before - afterFirst)}, charged on retry ${usdc(afterFirst - afterRetry)}`);

// 3. Provider outage → instant refund (local stack only: we control the gateway)
if (c.stack) {
  c.stack.setGenerate(async () => {
    throw new ProviderError("gemini_http_503");
  });
  const b0 = await bal();
  try {
    await steady.buy({ serviceId: c.serviceId, input: `Outage test ${Date.now()}: drone-delivered spare parts` });
  } catch (e) {
    console.log(`3. provider outage        → ${(e as StubError).code}, refunded ${usdc((await bal()) - (b0 - 50_000n))} of 0.0500 USDC`);
  }
  c.stack.setGenerate(mockGenerate);
}
await c.close();
