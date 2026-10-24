# Requirements traceability (master prompt → Stub)

Evidence labels: **unit** (Foundry), **local** (anvil + real gateway code), **testnet**, **mainnet**.

| § | Requirement | Implementation | Evidence |
|---|---|---|---|
| 4 | Merchant registers service, pricing | `registerService`, `/merchant` | unit, testnet contract |
| 4 | Verified USDC settlement | `StubEscrow` pay → fulfill/refund | unit, local |
| 4 | Gateway enforces payment & access | `lib/server/callCore.ts` | local (11 tests) |
| 4 | Metering / reconciliation | on-chain events + Redis result/failed keys; `/merchant` earnings | local |
| 4 | Buyer SDK | `packages/sdk` | local (17 tests) |
| 4 | Time-limited pass | not built (optional in prompt) | — |
| 4 | Merchant dashboard | `/merchant` | build + render check |
| 4 | Useful paid service | Pitch Brief (Gemini, strict schema) | local with fake provider |
| 5 | Arc Studio for contracts | reviewed, fixed, tested, deployed in Arc Studio | testnet `0x9777…10a5` |
| 5 | Replay protection, expiry, decimals, reentrancy, refunds | single-use ids, deadlines, 6-dec ERC-20, `nonReentrant`, CEI | unit (45) |
| 6 | Never charge twice on lost response | SDK persists id before pay, resumes, reuses id | local tests |
| 6 | Settled purchase can't unlock other service/buyer | service id + fulfiller + input hash + signer checks | local tests |
| 6 | Survives restart | chain + Redis only | local test #8 |
| 7 | First real consumer | `apps/deck-builder` (ComputeQuest repo rejected: malware, see research.md) | local tests |
| 7 | Bounded service wallet | `payAsAgent` with per-call/daily caps | unit, local |
| 7 | Output materially used | brief → deck generator; asserted in tests | local |
| 7 | Works with flag off | `USE_STUB=false` | local test |
| 9 | No arbitrary proxying, body limits, timeouts, rate limits | Gemini is the only upstream; 8 KB; 25 s; 20/min/IP | code + local |
| 9 | No secrets in logs/bundle | server-only env, ConfigError names only | local test #12 |
| 11 | Tests 1–12 | see `tests/` and `test/` | local, unit |
| 12 | Demo A / B / C | `examples/standalone-buyer.ts`, `apps/deck-builder/cli.ts`, `examples/failure-safety.ts` | local runs |
| E | Mainnet readiness | `docs/MAINNET.md` | — |
| F | Hosted app, repo, video, submission | `docs/SUBMISSION.md` | **pending (builder)** |
