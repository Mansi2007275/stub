# Stub — USDC Escrow API Marketplace

## Deployed contracts

| Contract | Chain | Address | Deploy tx |
|----------|-------|---------|-----------|
| `StubEscrow` | Arc Testnet | `0x9777da550470de0508d02d34b2c12b95e49c10a5` | `0x065b9a46b75d31c93edb41dc7d4e43e0f20fea8166fb8b9d40171ebe32970308` |

Constructor args: `usdc=0x3600000000000000000000000000000000000000`, `owner=0x71aEE14669EaF0a2f55b783Eed64Ad12B66177ee`, `feeRecipient=0x71aEE14669EaF0a2f55b783Eed64Ad12B66177ee`, `feeBps=300`

**Deploy block**: 68825953 (used as feed scan start)

## Token contracts

| Token | Chain | Address | Decimals |
|-------|-------|---------|----------|
| USDC | Arc Testnet | `0x3600000000000000000000000000000000000000` | 6 |

## ERC-8004 IdentityRegistry

| Chain | Address |
|-------|---------|
| Arc Mainnet | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Arc Testnet | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |

## Environment variables

All non-secret VITE_ vars live in `.env`. Secret vars must be set in Vercel after deploy.

| Variable | Value / Purpose |
|----------|-----------------|
| `VITE_CHAIN` | `testnet` |
| `VITE_ESCROW_ADDRESS` | `0x9777da550470de0508d02d34b2c12b95e49c10a5` |
| `VITE_USDC_ADDRESS` | `0x3600000000000000000000000000000000000000` |
| `VITE_SERVICE_ID` | `1` |
| `VITE_API_BASE` | `/api` |
| `VITE_ESCROW_DEPLOY_BLOCK` | `68825953` |
| `FULFILLER_PRIVATE_KEY` | **Secret** — Vercel only |
| `GEMINI_API_KEY` | **Secret** — Vercel only |
| `UPSTASH_REDIS_REST_URL` | **Secret** — Vercel only |
| `UPSTASH_REDIS_REST_TOKEN` | **Secret** — Vercel only |

## Post-deploy steps (Vercel)

1. Set the four secrets above in Vercel Dashboard → Settings → Environment Variables
2. Go to `/merchant` → Register service #1 with the fulfiller address (public key of `FULFILLER_PRIVATE_KEY`)
3. After registering, `/try` will accept purchases and generate pitch briefs

---

## Turn 1 — Initial integration

- Regenerated `src/lib/escrowAbi.ts`, `lib/server/escrowAbi.ts`, `shared/escrowAbi.ts` from `contracts/out/StubEscrow.sol/StubEscrow.json`
- Fixed broken `tsconfig.json` and `tsconfig.api.json`; set `vite.config.ts` historyApiFallback
- Installed: `react-router-dom@7`, `zod@3`, `@upstash/redis`, `@vercel/node` (dev)
- Lint/type-check: 0 errors ✅

## Turn 2 — SDK + e2e tests

- Installed `vitest@3`, `tsx@4`
- Added `out → contracts/out` symlink for test artifact resolution
- Created `vitest.config.ts` with 120 s per-test timeout
- Added scripts: `test:e2e`, `demo:a`, `demo:c`, `demo:agent`, `demo:deck`
- Added `scripts/export-abi.mjs` writes to `shared/escrowAbi.ts` too
- **forge test: 45/45 ✅ | vitest: 28/28 ✅**
- Fixed `tests/gateway.e2e.test.ts`: `abi: any` → `abi: unknown[]`
- `tsconfig.node.json` tsc: 0 errors ✅

## Turn 4 — v2: feed, paywall, Deck, ERC-8004, ticket wall

### New files created

| Path | Purpose |
|------|---------|
| `lib/server/feedCore.ts` | Redis-backed incremental event feed with distributed lock |
| `src/lib/useFeed.ts` | React hook: polls `/api/feed`, falls back to browser `getLogs` |
| `src/lib/feedView.ts` | Maps `FeedItem` → `TicketPhase` / `TicketData` for `EscrowTicket` |

### Files updated

- `src/lib/config.ts` — added `IDENTITY_REGISTRY` (ERC-8004, from Arc docs)
- `lib/dev/localStack.ts` — serves `GET /api/feed`; added `chainId` + `cors` opts to `startLocalStack`
- `packages/paywall/src/index.ts` — cast `generate` to satisfy `Deps` type (generic handler)
- `scripts/browser-e2e.ts` — `// oxlint-disable` (playwright is optional runtime dep)
- `tsconfig.json` — excludes `scripts/browser-e2e.ts` (needs playwright, not in workspace)
- `src/pages/Deck.tsx` — removed unused type imports (`WalletClient`)
- `src/lib/useFeed.ts` — `// oxlint-disable react/set-state-in-effect` (polling pattern is intentional)
- `src/pages/Receipt.tsx` — suppression comment on `Date.now()` in `useMemo`
- `.env` — appended `VITE_ESCROW_DEPLOY_BLOCK=68825953`
- `package.json` — added scripts: `demo:paywall`, `test:browser`

### New pages / features

- **Home** (`/`): live ticket wall with `useFeed` + EscrowTicket cards, stats, step-by-step explainer
- **Try** (`/try`): ticket printing animation through the full escrow flow
- **Receipt** (`/receipt/:id`): on-chain receipt verification + sharing
- **Agents** (`/agents`): punch-card budget display, ERC-8004 identity badge, revoke button
- **Merchant** (`/merchant`): earnings from feed (filtered by owned services), register service
- **Deck** (`/deck`): Deck Builder consumer app — buys brief from Stub, builds slides in-browser

### Test results (Turn 4)

| Suite | Tests | Result |
|-------|-------|--------|
| `forge test` (Foundry) | 45 | ✅ all pass |
| `tests/gateway.e2e.test.ts` | 11 | ✅ |
| `tests/sdk-consumer.e2e.test.ts` | 17 | ✅ |
| `tests/feed-paywall.e2e.test.ts` | 8 | ✅ |
| **Total vitest** | **36** | **✅ all pass** |
| `bun run check` (oxlint + tsc) | — | ✅ 0 errors |
| `tsc -p tsconfig.node.json` | — | ✅ 0 errors |

All six routes (`/`, `/try`, `/agents`, `/merchant`, `/deck`, `/receipt/:id`) return HTTP 200.

---

## Turn 5 — uploaded files verified; ANVIL_BIN fix; .gitignore audit

### What was checked

The six uploaded files were already on disk verbatim and required no edits:

- `src/lib/useFeed.ts` — bounded 20 k-block browser fallback; first scan fires immediately; `// oxlint-disable` present
- `src/lib/config.ts` — exports `DEPLOY_BLOCK`, `IDENTITY_REGISTRY`, all constants
- `lib/server/feedCore.ts` — 4 s cache, stale-cursor reset, keyed by escrow address
- `lib/dev/localStack.ts` — `freePort()` for both anvil and HTTP ports; `chainId` and `cors` opts; Multicall3 deploy at canonical address; CORS preflight handler
- `tests/gateway.e2e.test.ts` — uses `freePort()` from localStack
- `.gitignore` — bare `lib/` rule is gone; only anchored `/lib/openzeppelin-contracts/` and `/lib/forge-std/` are excluded, so `src/lib/`, `lib/server/`, and `lib/dev/` are committed

### Fix applied

- `vitest.config.ts` — added `env: { ANVIL_BIN: "/usr/local/bin/anvil" }` so all three test suites find anvil without relying on the `/root/.foundry/bin/` symlink (which is `EACCES` in this sandbox)

### Test results (Turn 5)

| Suite | Tests | Result |
|-------|-------|--------|
| `forge test` (Foundry) | 45 | ✅ all pass |
| `tests/feed-paywall.e2e.test.ts` | 8 | ✅ |
| `tests/gateway.e2e.test.ts` | 11 | ✅ |
| `tests/sdk-consumer.e2e.test.ts` | 17 | ✅ |
| **Total vitest** | **36** | **✅ all pass** |
| `bun run check` (oxlint + tsc) | — | ✅ 0 errors |
| `tsc -p tsconfig.node.json` | — | ✅ 0 errors |

---

## Turn 6 — Vercel build errors + Gemini model config

### The build errors (8 of them) were one root cause

Root `tsconfig.json` was `{ "files": [], "references": [] }` — **no `compilerOptions` at all**.
`npm run typecheck` passed because it uses `tsconfig.app.json` / `tsconfig.api.json` / `tsconfig.node.json`,
but Vercel's `@vercel/node` builder type-checks every `api/*.ts` entrypoint against the **root**
`tsconfig.json`. With no options it fell back to non-strict + `target: ES5`, which caused:

| Reported error | Why |
|---|---|
| `pitchBrief.ts` TS1360 / TS2322 — `title` optional in `PitchBrief` | zod infers every field as optional when `strictNullChecks` is off |
| `runtime.ts`, `api/feed.ts`, `api/quote.ts` — `account: { address: undefined }` not assignable to `undefined` | viem's `PublicClient` account type collapses without `strictNullChecks` |
| `Property 'chain' is missing`, `Property 'authorizationList' is missing` (`api/services.ts`, `api/purchase/[id].ts`, `callCore.ts`) | same — viem's optional-undefined params become required |
| `api/health.ts` TS2802 `--downlevelIteration` | default `target: ES5` (not in the pasted log, found locally) |

**Fix**: root `tsconfig.json` now carries the same `compilerOptions` as `tsconfig.api.json`
(`target: ES2022`, `strict: true`, `moduleResolution: bundler`, `types: ["node"]`). Keep the two in sync.

### Same file, second bug: editor-only "Cannot find name 'process'"

`examples/_env.ts` showed 17 errors in VS Code (TS2591 `process`, TS7006 implicit any) while
`npm run typecheck` was clean. Cause: VS Code attributes a file to a project whose `include` matches it.
`examples/` is covered **only** by `tsconfig.node.json`, which nothing points the editor at, so tsserver
fell back to `tsconfig.app.json` — `strict: true` with `types: ["vite/client"]`, i.e. no node types.
Proved it by temporarily adding `"node"` to the app project's `types`: all 17 errors vanished.

That is the wrong fix (browser code in `src/` would then see `process`/`Buffer` and TS would stop
flagging node APIs leaking into the Vite bundle). Instead the root `tsconfig.json` got an `include` for
the server/tooling side — `api`, `lib`, `examples`, `tests`, `packages`, `apps`, `shared` — with
`lib/openzeppelin-contracts` and `lib/forge-std` excluded. `src` is deliberately left out so it stays
with `tsconfig.app.json`.

Two gotchas found on the way:

- **Don't add `references` to the root config.** Without `composite: true` on the three projects (which
  `noEmit: true` forbids), `tsc` reports TS6305 "Output file `api/call.d.ts` has not been built" for
  every entrypoint. Plain overlapping `include`s are what works here.
- Root `lib` needs `DOM` (for `HeadersInit` in `examples/paywall-server.ts`). `tsconfig.api.json` stays
  `ES2022`-only and is still the stricter gate, since Vercel runs `npm run build` → `npm run typecheck`.

`tsc -p tsconfig.json` is now a real check and is the closest local equivalent to what Vercel does.

### Gemini: the key is valid, the model was wrong

`GEMINI_API_KEY` (`AQ.…`, 53 chars — the newer non-`AIza` key format) authenticates fine. The problems were:

1. **`GEMINI_MODEL=gemini-3.8-flash` is far too slow here** — 200 OK but **~290 s** for one brief on the
   free tier (queueing; `thinkingLevel: "low"` does not bound it). The generator budget is 45 s and
   `api/call.ts` has `maxDuration: 60`, so every real call would have returned `gemini_timeout`.
2. **Its free-tier cap is 20 requests/day/model** and it was exhausted (429 `RESOURCE_EXHAUSTED`).
3. **The fallback was not a fallback** — `GEMINI_FALLBACK_MODEL` defaulted to `gemini-flash-latest`,
   which *resolves to* `gemini-3.8-flash`, i.e. the same model and the same per-model daily quota.
4. **`gemini-2.5-flash` is dead** — 404 "no longer available to new users". It was still the default in
   `examples/_env.ts` and `apps/deck-builder/cli.ts`.

Measured with the real pitch-brief payload (schema + `thinkingConfig`):

| Model | Result |
|---|---|
| `gemini-3.8-flash` | 200 but ~290 s / 429 after 20/day |
| `gemini-3.5-flash-lite` | **200 in 2–3 s, consistently** ✅ |
| `gemini-3.6-flash` | 200 in 7–13 s, intermittent 503 |
| `gemini-3.1-flash-lite` | 200 in 4–48 s, frequent 503 |
| `gemini-2.5-flash` | 404 retired |

### Changes

- `.env`, `lib/server/env.ts`, `api/health.ts` — `GEMINI_MODEL=gemini-3.5-flash-lite`,
  `GEMINI_FALLBACK_MODEL=gemini-3.6-flash`. Both **pinned, never a `*-latest` alias** (an alias is how
  this drifted onto 3.8-flash) and deliberately two different models (the daily cap is per model).
- `lib/server/pitchBrief.ts` — one 700 ms retry on `503 UNAVAILABLE` before moving to the next model;
  without it the fallback died on transient overload. `geminiPing` timeout 12 s → 20 s so a briefly
  overloaded but working model is not reported as `TIMEOUT`.
- `examples/_env.ts`, `apps/deck-builder/cli.ts` — dead `gemini-2.5-flash` default → `gemini-3.5-flash-lite`.

### Vercel env vars to update

`.env` is gitignored, so the dashboard needs this by hand: set `GEMINI_MODEL=gemini-3.5-flash-lite` and
`GEMINI_FALLBACK_MODEL=gemini-3.6-flash`, **or simply delete `GEMINI_MODEL`** — the code defaults now match.
Verify after deploy with `GET /api/health?check=gemini`.

Free tier is 20 requests/day **per model** (so ~40 briefs/day across the pair). Enable billing on the
Google Cloud project behind the key to lift it.

### Test results (Turn 6)

| Suite | Result |
|---|---|
| `tsc -p tsconfig.json` (Vercel-equivalent) | ✅ 0 errors (was 8) |
| `examples/_env.ts` diagnostics in VS Code | ✅ 0 (was 17) |
| `npm run typecheck` (all three projects) | ✅ 0 errors |
| `npm run build` (typecheck + vite build) | ✅ built |
| `npm run test:e2e` (vitest) | ✅ 36/36 |
| `geminiGenerator` end-to-end, real key | ✅ 3/3, 2.4–4.1 s, schema valid, 5 slides |
| fallback path (bogus primary → `gemini-3.6-flash`) | ✅ 2/2, 8.8–10.8 s |
| `geminiPing` on both models | ✅ both 200 |

---

## Turn 7 — ran the whole project on Arc Testnet; fixed receipt-lag failures

### How to run it

```
npm run dev        # Vite on 127.0.0.1:5173 (hot reload)
npm run dev:full   # everything on http://localhost:4178  <- use this one
```

`scripts/dev-server.ts` serves the real `api/*.ts` handlers and proxies the rest to Vite, so the
whole app runs on one origin against the live contract. All six routes return 200.

### The bug: Arc indexes receipts minutes after the block

`eth_getTransactionByHash` reports a block number almost immediately, but
`eth_getTransactionReceipt` stays `null` for **minutes** on every Arc testnet RPC. viem's
`waitForTransactionReceipt` only consults the receipt, so it rejected after its 180 s default on
transactions that had **already succeeded**. Measured: `fulfill` mined in block 69394845, receipt
still unavailable 4 minutes later.

Consequences before the fix — the money was always correct, the reported outcome was not:

| Path | Symptom |
|---|---|
| `POST /api/call` | `fulfill` mined and escrow released, then handler threw `WaitForTransactionReceiptTimeoutError` at 186 s → buyer got `500 internal_error` for a call they paid for. On Vercel (`maxDuration: 60`) it is killed even earlier. |
| SDK `buy()` | threw on the `approve` and `pay` waits although both succeeded; the lock site already had an on-chain fallback but the throwing wait meant it never ran. |

**Fixes**

- `lib/server/callCore.ts` — added `confirmFulfill()`: polls the receipt, but treats
  `statusOf(purchaseId) == Fulfilled` as authoritative, with a 25 s budget that stays inside the
  60 s function limit. The contract gets the last word, not the receipt index.
- `packages/sdk/src/index.ts` — added `waitMined()`, returning `"success" | "reverted" | "unknown"`
  instead of throwing on lag. Replaced all three `waitForTransactionReceipt` calls
  (`ensureAllowance`, lock, `refund`). `"unknown"` falls through to the existing
  `getPurchase().status` check, so a mined-but-unindexed lock now resumes instead of failing.

### The other bug: the default RPC is rate-limited

`https://rpc.testnet.arc.io` (viem's first default for `arcTestnet`) returns
`-32005 rate limit exceeded` on plain `eth_call` under light use, which made `/api/services` fail
intermittently and made any `eth_getLogs` backfill impossible.

| Endpoint | Status |
|---|---|
| `rpc.testnet.arc.io` | ❌ rate limit exceeded |
| `rpc.blockdaemon.testnet.arc.io` | ✅ healthy — now pinned |
| `rpc.drpc.testnet.arc.io` | ✅ healthy — spare |
| `rpc.quicknode.testnet.arc.io` | ❌ rate limit exceeded |

`.env` — `ARC_TESTNET_RPC_URL` and `VITE_ARC_TESTNET_RPC_URL` pinned to blockdaemon. **Set these in
Vercel too**, or the deployed app falls back to the throttled default.

### Live end-to-end proof (Arc Testnet, real USDC)

`npm run demo:a` against the running gateway, buyer = fulfiller wallet:

```
purchase  0x7fc87863582b32199269992ebf588bbebbc8432aa596f1d2a0baffe29e1d70ec
locked    0x57eb0174f9a6a9fff20e453c0df8acb7b0132ed67d37dc6b779d8017f0d14ec7
released  0xf99539058cf025e71b987efcb305b7be8ea9dd7b0d6827cb57a560737e65afba
status    Released (read back from the escrow)
paid      0.0580 USDC   (0.05 price + gas)
```

`PurchaseFulfilled`: `merchantAmount=48500`, `feeAmount=1500`, sum `50000` — exactly the 300 bps fee.
`totalLocked` back to `0`, escrow USDC balance `0`: the accounting invariant holds.

### Notes on the chain itself

- **USDC is the native gas token.** Native balance (18 dp) and the `0x3600…` ERC-20 view (6 dp)
  mirror each other, so a buyer needs only USDC.
- Blocks are ~7/s; `feeBps=300`, `serviceCount=2`, service #1 active at 0.05 USDC with the
  fulfiller matching `FULFILLER_PRIVATE_KEY`.
- `/api/feed` advances 60 k blocks per request (12 × 5 k chunks) and persists its cursor in Redis, so
  from a cold Redis it needs ~9 polls to cross the 531 k blocks since the deploy block before the
  wall fills. Verified: cursor advanced 60 k per call, caught up, then tracked head in ~1.5 s.
  History on chain: 11 purchases, 5 released, 6 refunded.

### Test results (Turn 7)

| Suite | Result |
|---|---|
| `forge test` | ✅ 45/45 (incl. 4 k-call invariant fuzzing) |
| `npm run test:e2e` (vitest) | ✅ 36/36 |
| `npm run typecheck` (3 projects) | ✅ 0 errors |
| `tsc -p tsconfig.json` (Vercel-equivalent) | ✅ 0 errors |
| `npm run build` | ✅ built in 28.9 s |
| live purchase on Arc Testnet | ✅ locked → generated → released |

---

## Turn 8 — real flows only: no demo mode, no invented numbers, RPC throttling fixed

### 1. Reproduced: the blocker was NOT a block range

The `/try` failure after the quote came from a **per-IP request-rate limit on `eth_call`**, not from
log ranges. Captured verbatim against `rpc.testnet.arc.io`:

```
REQUEST  -> {"method":"eth_call","params":[{"to":"0x3600…0000",
            "data":"0xdd62ed3e…"},"latest"]}        <- allowance(buyer, escrow)
HTTP 429
RESPONSE <- {"error":{"code":-32005,"message":"rate limit exceeded"}}
```

viem surfaces `-32005` as **"Request exceeds defined limit."** — the exact string on the page. A
5,000-block `eth_getLogs` chunk against the same endpoint returned **HTTP 200**, so chunking was
never the problem. In `src/lib/payCall.ts` this `readContract` sat *between* the quote and
`onProgress({ step: "approve" })`, so the throw aborted the purchase before Approve could open.

### 2. RPC fixes

- **`src/lib/rpc.ts` (new)** — ordered endpoint list (configured primary → `VITE_RPC_URL_FALLBACK` →
  known-good), a viem `fallback` transport, `isRpcBusy()` for `-32005`/429, `withRpcRetry()` with
  exponential backoff, and `RPC_BUSY_MESSAGE`.
- **`src/lib/wagmi.ts`, `lib/server/chain.ts`** — both now use the fallback transport.
  Server honours `RPC_URL_FALLBACK`.
- **`src/lib/payCall.ts`** — the allowance read is wrapped in `withRpcRetry`; receipt waits are
  lag-tolerant (`waitMined`) and settle against `statusOf` when the receipt is not indexed;
  `humanError()` converts throttling into *"Network is busy, retry in a few seconds. You have not
  been charged."* Exact-amount approve kept — never infinite.
- **`shared/feed.ts`** — the three `getLogs` per chunk now run **sequentially** with retry/backoff
  (three concurrent queries per chunk is what tripped the limiter). Still 5,000-block chunks from
  `DEPLOY_BLOCK`, never block 0.
- **`src/lib/useFeed.ts`** — polling 8s → **30s**, exponential backoff to 4 min while throttled, and
  it **stands down entirely while a payment is in flight** (`isPaymentInProgress()`), so a buyer's
  approve/pay never loses the rate-limit race to a background refresh.
- **Resume** reads the purchase by id from the contract/Redis. No log scanning anywhere in that path.

Measured, with the throttled endpoint still FIRST in the list:

| `allowance()` × 12 | Result |
|---|---|
| single throttled endpoint (before) | **0 ok / 12 failed** |
| fallback transport (after) | **12 ok / 0 failed** |

### 3. Demo and predefined content removed

Grepped `mock|demo|sample|placeholder|fake|hardcod|seed|dummy|FALLBACK|TODO` across
`src shared lib api apps packages`. Deleted:

| Removed | Why |
|---|---|
| `src/components/Ticket.tsx` | Hero ticket with **fabricated** `purchaseId`/`resultHash`/`inputHash` on an animated fake Locked→Delivered→Released loop |
| `examples/` (6 files) | Demo scripts, incl. `_env.ts` holding the `[LOCAL MOCK]` canned pitch brief |
| `apps/deck-builder/cli.ts` | Demo CLI (the real in-browser Deck page stays) |
| `demo:*` npm scripts (6) | demo:a, demo:c, demo:agent, demo:deck, demo:local, demo:paywall |
| `EscrowTicket` `sample` prop, `.sample-tag` CSS | The "Sample" badge |
| `data.amount ?? 50_000n`, `feeBps ?? 300` | Invented amount and fee when the chain had not said |
| `"0.05 per call · 0.25 per day"`, `"97%"`/`"3%"` copy | Hardcoded stats, now read from `feeBps` on-chain |

Replaced with a real empty state (**"No calls yet"**). Verified absent from `dist/`.

**Kept deliberately** (not fake): `lib/dev/localStack.ts` + `MockUSDC` are the anvil harness the 36
vitest e2e tests run on — deleting them deletes the test suite, and step 6 requires tests to pass.
No user-facing page can reach them. Input `placeholder` attributes are real UX hints;
`Guilloche seed` is a PRNG seed for decorative SVG; `GEMINI_FALLBACK_MODEL` is a real backup model.

### 4. Prices and limits are configurable

- `/try` and `/deck` read the price from `services(serviceId)` on-chain; `STEPS` takes it as an
  argument. No `0.05` anywhere in `src/`.
- `/merchant` price and `/agents` per-call + daily cap now start **empty** — the user types them.
  Floor is `MIN_USDC` (0.000001, USDC's 6-decimal limit).
- Agent validation keeps **only** the contract's rule (`dailyCap >= perCall`); no frontend ceiling.
- Timeout bounds (60 s … 604800 s) mirror `MIN_TIMEOUT`/`MAX_TIMEOUT`.
- **Reported, not changed:** `StubEscrow` has **no max-per-call constant**. Price is `uint96`, so the
  ceiling is 2^96−1 base units. `MAX_FEE_BPS = 500` caps the *protocol fee*, not a price. Added
  optional `VITE_MAX_PER_CALL` for UI validation only — unset by default, so nothing is capped.

### 5. Verified on Arc Testnet (real USDC)

| Check | Evidence |
|---|---|
| Paid call → Released | `/api/call` **HTTP 200 in 5.6 s** (was 500 after 186 s); `statusOf = Fulfilled`; `totalLocked = 0` |
| lock tx | `0x4316738a1ca98d83404e57e02b279732929b3b7724520cb598449cba1690e009` |
| release tx | `0x329fef36cd29d95dd8dc8a24dd4ded77f4d74d0430caeb36eeea4817dec8ecb3` |
| Price read from chain | `0.05 USDC`, `feeBps = 300`, both read live, not constants |
| Resume without double pay | replay → `ok=true cached=true`, **balance delta 0 base units** |
| Receipt Match | recomputed `keccak256(canonicalJson(result))` == on-chain `resultHash` |
| Receipt No match | title edited by one word → **NO MATCH** |

**Not verified — needs permission.** Registering a service at a non-0.05 price, the refund path, and
a custom agent budget each send new on-chain transactions; the auto-mode classifier blocked that
script as a *Real-World Transaction*. The code paths are covered by `forge test` and the e2e suite,
but they have not been exercised against the live contract in this turn.

### 6. Test results (Turn 8)

| Suite | Result |
|---|---|
| `forge test` | ✅ 45/45 |
| `npm run test:e2e` (vitest) | ✅ 36/36 |
| `npm run typecheck` (3 projects) | ✅ 0 errors |
| `tsc -p tsconfig.json` (Vercel-equivalent) | ✅ 0 errors |
| `oxlint` | ✅ only one pre-existing warning (`pitchBrief.ts:74`) |
| `npm run build` | ✅ built in 33 s |

Nothing committed; `.env` is gitignored and unstaged.

---

## Turn 9 — `scripts/` had no TypeScript project (21 editor errors)

`scripts/dev-server.ts` showed 21 errors in VS Code (TS2591 `process`/`Buffer`/`node:*`, TS7006
implicit `any`, TS2339 `unref` on `number`) while `npm run typecheck` was clean — the same
mis-attribution as `examples/_env.ts` in Turn 6, in a directory that had simply been missed:
**no tsconfig `include` matched `scripts/`**, so tsserver fell back to `tsconfig.app.json`
(`types: ["vite/client"]`, no node types). Nothing was wrong with the file.

### Fix

- `tsconfig.json` — added `"scripts"` to `include`; added `scripts/browser-e2e.ts` to `exclude`
  (optional playwright dep, not in the workspace).
- `tsconfig.node.json` — same: `"scripts"` in `include`, `scripts/browser-e2e.ts` excluded, and the
  dead `"examples"` entry removed (that directory was deleted in Turn 8). `npm run typecheck` now
  actually covers `scripts/dev-server.ts`.

`src` is still deliberately absent from the root project, so browser code cannot see `process`/`Buffer`.

| Check | Result |
|---|---|
| `scripts/dev-server.ts` diagnostics in VS Code | ✅ 0 (was 21) |
| `tsc -p tsconfig.json` (Vercel-equivalent) | ✅ 0 errors |
| `tsc -p tsconfig.app.json` / `tsconfig.api.json` / `tsconfig.node.json` | ✅ 0 errors |

---

## Turn 10 — "Network is busy" was hiding the real error

### Root cause: the busy check was a text match

`isRpcBusy()` matched `/rate limit|exceeds defined limit|too many requests|429/i` against
`message + details + shortMessage`. A viem error **message embeds the whole request dump**
(`Request Arguments: from: 0x… to: 0x… data: 0x095ea7b3…`), so any unrelated failure whose hex
happened to contain the substring `429` was reported to the buyer as *"Network is busy, retry in a
few seconds."* The real error never reached the UI and nothing logged it.

Second, smaller cause: `STEPS` in `src/pages/Try.tsx` had **no `quote` row** (it started at
"Approve USDC") while `ORDER` did. A failure during the quote or the allowance read — the two calls
that run *before* the Approve popup — therefore showed its message with "Approve USDC" as the first
row, which reads as "it failed on Approve".

### Changes

| File | Change |
|---|---|
| `src/lib/rpcError.ts` **(new)** | Pure classification, split out of `rpc.ts` so it has no `import.meta.env` and is unit-testable from node. `isRpcBusy` is now **structured-only**: JSON-RPC `-32005` (incl. nested `data.code`, as MetaMask wraps it), HTTP `429`, or viem's `LimitExceededRpcError`, walked down the whole `cause` chain. No text matching. Adds `describeRpcError` (method/code/status/name/url/message) and `logRpcError`. |
| `src/lib/rpc.ts` | Every endpoint is wrapped in a logging `http()` transport: each JSON-RPC call is recorded with method, block range or `to`+selector, HTTP status, JSON-RPC error code and latency, paired request→response **by JSON-RPC id**. Non-200 or any RPC error is `console.error`-ed. Ring buffer of 300, readable in the console as `__stubRpc.recent(60)`. Re-exports the classifier. |
| `src/lib/payCall.ts` | Each chain-touching call runs inside `step(label, fn, via)`, which on failure logs the raw error + facts, prints **`[pay] first failing call: <label>`** and `console.table`s the last 60 s of RPC traffic. `/api/quote` failures now carry their real HTTP status and body. `humanError` returns the busy message **only** when `facts.busy`, handles wallet rejection by `code === 4001`, and otherwise shows the real text plus the code. |
| `src/lib/payCall.ts` | New `WalletRpcBusyError`: a write goes out through the **wallet's own** transport, so it is throttled by whatever RPC URL the wallet has for Arc — `RPC_URLS` cannot help and retrying is pointless. That case now says to change the Arc RPC URL in the wallet instead of blaming the app. |
| `src/pages/Try.tsx` | Added the missing **"Get a quote"** step row, so the row that fails is the row that failed. |
| `lib/server/chain.ts` | Same logging transport server-side: `recentRpcCalls(60)` plus a console line per call (method + block range + status + ms + host). Errors always log; `RPC_DEBUG=1` echoes every call. |
| `tests/rpc-errors.test.ts` **(new)** | 11 tests pinning the regression. |

### Measured on Arc Testnet (2026-10-28)

All four endpoints healthy (`eth_chainId` HTTP 200 on blockdaemon, drpc, arc.io, quicknode), so
nothing was being throttled when the buyer saw "Network is busy":

| Check | Result |
|---|---|
| `POST /api/quote` | **HTTP 200** in 1.16 s — exactly 2 RPC calls: `eth_call services(1)` (`0x56270e17`) + `eth_chainId`, both 200 @ blockdaemon |
| `GET /api/services` | HTTP 200 in 0.85 s |
| `GET /api/feed` | HTTP 200 — `eth_blockNumber` + 3 × `eth_getLogs (blocks 69440964..69444992)`, all 200 |
| `allowance(buyer, escrow)` — the last call before the Approve popup | **HTTP 200**, returns `0`, i.e. the popup *should* open |
| Server-side RPC errors in the window | **none** |

So the failure is not server-side and not throttling. It was the classifier mislabelling it.

### Test results (Turn 10)

| Suite | Result |
|---|---|
| `npx vitest run tests` | ✅ **47/47** (36 existing + 11 new) |
| `tsc` × 4 projects (app, api, node, root) | ✅ 0 errors |
| `oxlint src shared lib api tests` | ✅ only the pre-existing `pitchBrief.ts:74` warning |
| `npm run build` | ✅ built in 47 s |
| all six routes on the dev server | ✅ 200 |

### Not done

Driving `/try` to the Approve popup in the browser: the Claude-in-Chrome extension is not connected
(`list_connected_browsers` → `[]`) and Playwright is not installed, and only the user's own Chrome +
wallet can reach a real Approve popup. Nothing committed.
