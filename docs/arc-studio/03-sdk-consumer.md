Add the buyer SDK, the Deck Builder consumer app, the demo scripts and the end-to-end tests to this Stub workspace.

Uploaded at their real paths:
- packages/sdk/** (StubClient: quote → approve → pay/payAsAgent → sign → /api/call; crash-safe, never pays twice)
- apps/deck-builder/** (separate consumer app: buys a Stub brief with an agent budget, builds a deck, USE_STUB flag)
- examples/** (Demo A standalone buyer, agent budget, Demo C failure safety)
- lib/dev/localStack.ts (anvil + MockUSDC + StubEscrow + local HTTP gateway running the same code as /api)
- lib/server/quoteCore.ts, api/quote.ts, shared/escrowAbi.ts, scripts/export-abi.mjs
- tests/gateway.e2e.test.ts, tests/sdk-consumer.e2e.test.ts (vitest, local chain)
- docs/** (research, architecture, requirements, risks, SECURITY, MAINNET)
- tsconfig.node.json

Please:
1. Install dev deps vitest@3 and tsx@4 if missing, and add package.json scripts:
   "test:e2e": "forge build && vitest run tests",
   "demo:a": "tsx examples/standalone-buyer.ts", "demo:c": "tsx examples/failure-safety.ts",
   "demo:agent": "tsx examples/agent-buyer.ts", "demo:deck": "tsx apps/deck-builder/cli.ts"
2. Run `forge build` then `vitest run tests` (they start anvil themselves; set ANVIL_BIN if anvil is not on PATH). Report results.
3. Run the four demos with `--local` and report their output.
4. Run the typecheck for tsconfig.node.json and fix any issue without changing behaviour.
5. Update AGENTS.md (what was added, test results, remaining builder steps).
Do not deploy to mainnet and do not change StubEscrow.sol.
