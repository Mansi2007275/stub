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
(`target: ES2022`, `strict: true`, `moduleResolution: bundler`, `types: ["node"]`), with `files: []` kept
so it still compiles nothing itself. Keep these two files in sync.

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
| `tsc` with root `tsconfig.json` over `api` + `lib/server` + `shared` (Vercel-equivalent) | ✅ 0 errors (was 8) |
| `npm run typecheck` (all three projects) | ✅ 0 errors |
| `npm run build` (typecheck + vite build) | ✅ built |
| `npm run test:e2e` (vitest) | ✅ 36/36 |
| `geminiGenerator` end-to-end, real key | ✅ 3/3, 2.4–4.1 s, schema valid, 5 slides |
| fallback path (bogus primary → `gemini-3.6-flash`) | ✅ 2/2, 8.8–10.8 s |
| `geminiPing` on both models | ✅ both 200 |
