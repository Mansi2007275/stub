# Stub mainnet deployment and final verification

Production: **https://stub-mainnet.vercel.app**. This is a verification record, not permission to
deploy, register another service or spend unused acceptance budget. No custom-domain work is included.

## Deployed configuration

| Setting | Actual value |
|---|---|
| Chain | Arc Mainnet, 5042 |
| Escrow | [0xf294eCC15b52A5c7Ab7466885b8a033CB92C85c1](https://explorer.arc.io/address/0xf294eCC15b52A5c7Ab7466885b8a033CB92C85c1) |
| Deployment block | 28670061 |
| Deployment transaction | [0xa10cf069ee94936475c58a533b0a3a1334b4d026d27e2ae31695f63fc81e1c49](https://explorer.arc.io/tx/0xa10cf069ee94936475c58a533b0a3a1334b4d026d27e2ae31695f63fc81e1c49) |
| Service | 1, active |
| Price / timeout | 10000 base units (0.01 USDC) / 600 seconds |
| Owner / merchant / protocol recipient | 0x075FF540a0F8e9340a4813EF96C609Dc203A3041 |
| Gateway | 0x499b7494b08163d867286b31fF25Fcd1038e03Ae |
| USDC | 0x3600000000000000000000000000000000000000; 6 ERC20 decimals |
| Protocol fee | 300 bps: merchant 9700, protocol 300 per 10000-unit payment |

See [deployment record](mainnet-deployment.json). Native gas uses 18 decimal precision and mirrors
the ERC20 USDC balance; these are not two separate balances to add together.

## Fresh no-spend verification

[Chain report](mainnet-final-verification.json), checked **2026-10-31T04:38:55.847Z**, block
**28761451**: expected owner/recipient/USDC/fee and service settings match; escrow is
unpaused, **totalLocked=0**, buyer **remainingAllowance=0**. Runtime bytecode matches the compiled
artifact after masking constructor immutables, whose actual settings were separately read.
All five historical Phase B receipts were re-read successfully; existing early-refund and paid-Deck
purchases remain Refunded and Fulfilled, and the Phase A timeout purchase remains Refunded.

Fresh [production application checks](mainnet-app-verification.json) used existing authenticated
Vercel CLI access. Gateway key parses successfully and derives the intended public address; no
saved Sensitive value was retrieved. Redis feed read/write/cache checks returned 200 on chain 5042.
Six frontend routes and four JS/CSS assets returned 200 with expected content types. The deployed
bundle contains the mainnet escrow/RPC/explorer and not the old testnet escrow. Unknown API routes
return 404 rather than the SPA. Gemini results and one bounded recheck are recorded, including
transient timeouts; these small probes do not prove full paid generation reliability.

[Free Deck](mainnet-free-deck-verification.json) was freshly exercised on production with a fresh
browser, wallet disconnected, paid API and wallet signing/broadcast requests blocked. Five slides
and the correctly labelled HTML download passed; zero paid requests, signatures or transactions.

[Production source inspection](mainnet-production-source-check.json) read only the existing uploaded
source archive, not environment values. Actual production api/call.ts and lib/server/runtime.ts
match the local production handlers and contain no acceptance injection/manifest/gateway guard.
The controlled provider-failure mechanism is unavailable in those production handlers; it exists
only in the previously isolated protected acceptance build. No production deployment was performed.

Anonymous production root and health access currently return **200** under the existing policy.
The [protection record](mainnet-final-protection.json) documents unchanged production deployment
**dpl_FQ8jUVuAdit7kULr6veXKoAR9VNw**, SSO **all_except_custom_domains** and password policy.
Testnet health and the separate root Vercel link are checked separately. The working testnet .env
is not edited, staged or copied into mainnet configuration.

Explorer publication status: see [browser check](mainnet-explorer-check.json). Direct API requests
returned 403, so they alone do not establish verification status. A normal browser Contract-tab
check is the authoritative report. **BLOCKED: explorer address API returned is_verified=false and the smart-contract API has no published source (normal browser HTTP 200, 2026-10-31 07:30:58 UTC). Local bytecode matching does not substitute for explorer publication. Per the operator?s condition, no commit or push is permitted until this gate is resolved.**

## Acceptance evidence and limitations

[MAINNET-ACCEPTANCE.md](MAINNET-ACCEPTANCE.md) distinguishes actual mainnet receipts, historical
protected-build UI evidence, stable-production checks and deterministic local tests. Phase A
timeout refund and Phase B controlled early refund/paid Deck/cached replay passed. Phase B gross
was **0.033747503 USDC**, including **0.02** full principals and **0.013747503** gas. No returned
principal or merchant revenue was subtracted. Remaining accounting headroom is **0.019852497**,
with **no remaining authorization to spend it**.

Original Phase A resume is **untested** (original input unavailable). Live receipt-lag/pending
handling and full completed-Deck reload persistence were not verified. Local fresh-instance
recovery tests show an interrupted purchase can resume with persisted pending state and the
original input; a completed job's in-memory store is lost and its SDK pending record cleared,
so a new build may request a new purchase. Do not claim completed-job reload is idempotent.

The project is **not fully verified** while these limitations/source-publication gate remain.
Production paid behavior was not newly exercised in this no-spend run.

## Configuration and repository safety

Use [mainnet.env.example](mainnet.env.example) only as a public reference. Preserve testnet .env.
All keys/tokens remain server-side, never VITE_* or tracked env files. Encrypted keystores,
Vercel credentials, raw broadcast journals, caches and machine-specific acceptance snapshots
are excluded. Necessary public transaction/status reports are retained; transient source inventories,
operator execution scripts, raw UI captures and superseded reports remain local and unstaged.
Earlier chronological notes are preserved locally in ignored .vercel/final-review/original-docs.

Run local validation with Foundry/Anvil installed: forge test, forge build, npm run test:e2e,
npm run typecheck, tsc -p tsconfig.json, npm run build and git diff --check. On Windows set
ANVIL_BIN to the installed anvil.exe. Vitest now discovers only tests/**/*.test.ts, excluding
ignored deployment snapshots. [Local result record](mainnet-local-verification.json).

No live purchases, approvals, signatures, transactions, deployments, registrations, environment,
access-policy, domain or DNS changes were performed during final verification.
