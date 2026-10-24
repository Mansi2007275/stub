# Progress ledger

Evidence is labelled by where it happened. Local-chain results are not testnet or mainnet evidence.

## Arc Studio
- Workspace: https://studio.arc.io/app/618a850a-ca69-4746-8dbf-2a60cb9d45cd
- Turn 1 (2026-10-24): Arc Studio reviewed StubEscrow, fixed `foundry.toml` test path, added `DailyCapBelowPerCall` validation + 2 tests, ran 45/45 tests, deployed to Arc Testnet.
- Turn 2 (2026-10-24): app integrated into the workspace; lint + typecheck clean; preview loads all routes.
- Turn 3 (2026-10-24): SDK, Deck Builder, demos and e2e tests added; Arc Studio ran 28/28 e2e tests and all four demos with --local.

## Testnet (Arc Testnet, chain 5042002)
| What | Value | Verified |
|---|---|---|
| StubEscrow | `0x9777da550470de0508d02d34b2c12b95e49c10a5` | code present (9631 bytes) via RPC |
| Deploy tx | `0x065b9a46b75d31c93edb41dc7d4e43e0f20fea8166fb8b9d40171ebe32970308` | receipt status 1 |
| Constructor state | usdc `0x3600…0000`, owner/feeRecipient `0x71aE…77ee`, feeBps 300 | read back via `cast call` |
| Services registered | 0 | `serviceCount()` |

## Local
- Foundry: 45/45 (unit, fuzz, 2 invariants).
- Gateway e2e on anvil: 11/11 (unpaid denied, bad signature, input mismatch, wrong service, deliver + 97/3 split, retry never re-charges, concurrent duplicates, provider failure refunds, deadline guard, agent purchase).
- SDK + Deck Builder e2e on anvil: 17/17 (Demo A, maxPrice guard, lost response, crash before pay, crash after pay, provider refund + failure record, agent caps, restart ×2 (#8), deck built from real brief (#10), generator receives purchased brief, job idempotency, flag off moves no USDC (#11), clean failure, no secrets in responses/errors/bundle (#12)).
- Mutation check: disabling the SDK's resume logic makes 3 tests fail.
- Demos run locally: A, agent budget, C, Deck Builder (flag on and off), second seller via @stub/paywall.
- Feed + paywall e2e on anvil: 8/8 (statuses + totals, chunked scan equals single pass, concurrent scans don't double count, GET /api/feed, paywall sells + pays 97%, wrong-service purchase refused, throwing handler refunds, body/route limits). Total e2e: 36/36.
- Real browser (Chromium) on anvil with Arc Testnet chain id, injected dev wallet: home empty state → connect → paid call to Released → ticket on wall + stats → receipt verify (match, tampered rejected) → list service #2 → agent budget, allowance, revoke → Deck Builder with Stub and with flag off → mobile no overflow. `npm run test:browser`.
- Bug found by tests and fixed: viem caches block numbers (~4 s), which made the feed lag; feed now reads the head with cacheTime 0.
- Bug fixed: the old Merchant page queried 200k blocks of logs, which Arc's RPC rejects (limit ~5k). It now uses the chunked feed.

## Pending (needs Mansi)
1. Register the Pitch Brief service on testnet from /merchant (fulfiller = new gateway wallet).
2. Vercel deploy with FULFILLER_PRIVATE_KEY, GEMINI_API_KEY, UPSTASH_* → run one testnet paid call.
3. Mainnet deploy (small amounts) + one mainnet paid call → fill docs/SUBMISSION.md.
4. Video, then DoraHacks submit.
