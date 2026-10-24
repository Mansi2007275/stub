Please keep these uploaded files exactly as provided (only add lint-disable comments if your linter requires it; do not restructure them):

- src/lib/useFeed.ts — the browser fallback must scan only the most recent ~20,000 blocks (bounded by VITE_ESCROW_DEPLOY_BLOCK) and run its first scan immediately. Scanning from the deploy block on every page load would take hours once the chain has grown; full history comes from /api/feed.
- src/lib/config.ts — must export DEPLOY_BLOCK (used by useFeed).
- lib/server/feedCore.ts — keeps the 4 s cache, the stale-cursor reset, and keys the feed by escrow address so a new (mainnet) escrow never inherits testnet history.
- lib/dev/localStack.ts — clients must use the chain id anvil runs with (browser e2e uses 5042002); installs a dev Multicall3 at 0xcA11… because wagmi batches reads through it; answers CORS preflight; uses OS-assigned free ports so parallel test suites never collide.
- tests/gateway.e2e.test.ts — uses freePort().
- .gitignore — the old "lib/" rule ignored src/lib, lib/server and lib/dev. Only the Foundry deps under /lib are ignored now. Make sure src/lib/**, lib/server/** and lib/dev/** are committed when you push to GitHub.

Then run forge test, vitest run tests (36 expected), typecheck and lint, and update AGENTS.md (turn 5). Do not deploy to mainnet.
