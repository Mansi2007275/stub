Update this Stub workspace with the v2 app: live on-chain ticket wall, ticket printing on /try, receipt verification and sharing, punch-card agent budgets with revoke and ERC-8004 identity badge, a Deck Builder page, merchant earnings from the feed, the /api/feed endpoint and the @stub/paywall package.

Uploaded at their real paths (all files changed since your last turn):
- shared/feed.ts (chunked incremental event scan; Arc RPC caps eth_getLogs at ~5,000 blocks), shared/protocol.ts (canonicalJson, resultHashOf)
- lib/server/feedCore.ts, api/feed.ts (Redis cursor + lock), lib/server/callCore.ts (generic results), lib/server/pitchBrief.ts
- packages/paywall/** (stubPaywall: sell any function; fetch + express adapters), packages/sdk/** (generics, localStoragePending, node.ts)
- apps/deck-builder/** , examples/paywall-server.ts, lib/dev/localStack.ts, test/mocks/Multicall3.sol (dev only, for bare anvil)
- src/** (EscrowTicket, useFeed, Home, Try, Receipt, Agents, Merchant, Deck pages, styles), index.html, public/og.png
- tests/feed-paywall.e2e.test.ts, scripts/browser-e2e.ts, docs/**

Please:
1. Integrate these files. Keep the existing design system. Add VITE_ESCROW_DEPLOY_BLOCK=68825953 to the preview env (deploy block of the testnet escrow).
2. Add package.json scripts "demo:paywall": "tsx examples/paywall-server.ts" and "test:browser": "tsx scripts/browser-e2e.ts".
3. Run `forge build`, `forge test`, then `vitest run tests` (36 e2e tests expected) and `npx tsc --noEmit -p tsconfig.node.json`. Fix lint/type issues without changing behaviour. Report results.
4. Make sure the preview loads /, /try, /agents, /merchant, /deck and /receipt/<32-byte hex> with no runtime errors. On the live preview the home page should show the "On Arc right now" section reading the testnet escrow.
5. Update AGENTS.md (turn 4: what changed, test results).
Do not deploy to mainnet and do not change contracts/StubEscrow.sol.
