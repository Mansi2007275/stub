# @stub/paywall

Sell any function as a pay-per-call API. Buyers lock USDC in StubEscrow, your handler runs, the escrow releases 97% to you. If your handler throws, the buyer is refunded in the same request.

```ts
import { arcTestnet } from "viem/chains";
import { stubPaywall, upstashStore } from "@stub/paywall";

const paywall = stubPaywall({
  escrow: "0x9777da550470de0508d02d34b2c12b95e49c10a5",
  serviceId: 2n,                                   // from your registerService tx
  fulfillerKey: process.env.FULFILLER_PRIVATE_KEY as `0x${string}`,
  rpcUrl: "https://rpc.testnet.arc.io",
  chain: arcTestnet,
  store: upstashStore(process.env.UPSTASH_REDIS_REST_URL!, process.env.UPSTASH_REDIS_REST_TOKEN!),
  handler: async (input) => ({ taglines: await writeTaglines(input) }),
});

// Web-standard runtimes (Vercel functions, Next.js route handlers, Bun, Deno, Workers):
export const POST = paywall.fetch;        // mount at /api/stub/[op] → POST /api/stub/quote, /api/stub/call

// Express:
app.post("/stub/:op", express.json(), paywall.express);
```

Steps
1. Register the service on Stub's `/merchant` page with **Gateway address** = the address of `FULFILLER_PRIVATE_KEY`.
2. Mount the paywall and deploy.
3. Buyers call `new StubClient({ apiBase: "https://you.example/api/stub", … }).buy({ serviceId: 2n, input })`.

What the paywall checks before your handler runs: the purchase is Locked on-chain, belongs to your service and your fulfiller key, the input matches the hash the buyer paid for, the request is signed by the payer (or its agent), and the deadline isn't about to pass. One run per purchase (store lock); retries get the stored result.

See `examples/paywall-server.ts` for a runnable second service (Tagline Writer).
