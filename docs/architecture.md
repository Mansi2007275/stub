# Architecture

```mermaid
flowchart LR
  subgraph Buyers
    UI[Stub web app<br/>/try /agents /merchant /receipt]
    SDK[@stub/sdk<br/>scripts & agents]
    DB[Deck Builder<br/>consumer app]
  end
  subgraph Gateway[Stub gateway — Vercel functions]
    Q[/api/quote/]
    C[/api/call/]
    P[/api/purchase/:id/]
  end
  R[(Upstash Redis<br/>result cache · lock · rate limit)]
  G[Gemini<br/>only upstream]
  E[[StubEscrow on Arc<br/>source of truth]]

  UI -- approve · pay --> E
  SDK -- pay / payAsAgent --> E
  DB --> SDK
  UI & SDK -- signed request --> C
  UI & SDK --> Q
  C -- read purchase --> E
  C -- lock · cache --> R
  C -- generate --> G
  C -- fulfill / refundEarly --> E
  P -- read --> E
```

## Purchase state machine

| Prompt state | Where it lives |
|---|---|
| CREATED | `/api/quote` issued a fresh `purchaseId`; SDK persists it **before** sending pay |
| PAYMENT_PENDING | pay tx sent, `lockTx` recorded by the SDK |
| SETTLED | escrow `status = Locked` (funds held, deadline set) |
| FULFILLING | Redis `SET NX` lock held by one gateway worker |
| FULFILLED | escrow `status = Fulfilled`, `resultHash` on-chain, result in Redis |
| FAILED → refunded | provider error → `refundEarly`, `stub:failed:<id>` records the reason |
| EXPIRED | deadline passed without delivery → buyer `refund` |
| UNRESOLVED | lock tx not mined → SDK re-sends with the **same** id (contract rejects a second lock) |

On-chain state is authoritative; Redis holds only the result body and short-lived locks, so a gateway restart loses nothing (tests #8).

## Order of checks in `/api/call`
1. Body schema, size ≤ 8 KB, per-IP rate limit.
2. Purchase exists and is for this service and this gateway's fulfiller key.
3. `keccak256(input) == inputHash` committed at pay time.
4. EIP-191 signature from the payer or its agent (ERC-1271/6492 aware via `verifyMessage`).
5. Fulfilled → return cached result. Refunded → 409.
6. Deadline at least 30 s away.
7. Redis lock → reuse stored result or generate → store → `fulfill(purchaseId, keccak256(result))`.

## Money flow
`pay` pulls exactly `price` (balance-delta checked). `fulfill` sends `price − fee` to the merchant and `fee` (3%) to the fee recipient in one transaction. `refund`/`refundEarly` return the full amount to the **payer** (the owner when an agent bought). Amount, fee, merchant and fulfiller are snapshotted at lock.
