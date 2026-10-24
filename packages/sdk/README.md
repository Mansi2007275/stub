# @stub/sdk

Buy a Stub service (pay-per-call USDC escrow on Arc) from any TypeScript app or agent.

```ts
import { createPublicClient, createWalletClient, http } from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { StubClient, filePending } from "@stub/sdk";

const account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });

const stub = new StubClient({
  apiBase: "https://<your-stub>.vercel.app/api",
  escrow: "0x9777da550470de0508d02d34b2c12b95e49c10a5",
  publicClient,
  walletClient,
  pending: await filePending(".stub-pending.json"), // crash-safe: never pays twice
});

const { result, purchaseId, lockTx, fulfillTx } = await stub.buy({ serviceId: 1n, input: "my startup idea…", maxPrice: 100_000n });
```

Agent mode (spends an owner's on-chain budget; the contract enforces per-call and daily caps):

```ts
const agent = new StubClient({ ...opts, walletClient: agentWallet, agentOf: ownerAddress });
```

| Method | What it does |
|---|---|
| `buy({ serviceId, input, maxPrice? })` | quote → approve → pay → sign → call. Resumes unfinished purchases instead of paying again. |
| `collect(purchaseId, input)` | Fetch the result of a paid purchase. Retries never pay. |
| `getPurchase(purchaseId)` | Read the escrow state. |
| `refund(purchaseId)` | Reclaim after the deadline if nothing was delivered. |

Errors are `StubError` with a `code` (`price_above_max`, `refunded`, `provider_failed`, `bad_signature`, `not_paid`, …).
