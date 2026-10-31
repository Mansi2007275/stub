import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run repository tests only, not ignored deployment snapshots under .vercel/.
    include: ["tests/**/*.test.ts"],
    // E2E tests start anvil and deploy contracts — generous per-test timeout
    testTimeout: 120_000,
    hookTimeout: 90_000,
    // Each suite gets its own anvil on an OS-assigned free port
    pool: "forks",
    poolOptions: { forks: { singleFork: false } },
    // Set ANVIL_BIN if Foundry's anvil isn't on PATH (e.g. ANVIL_BIN=$HOME/.foundry/bin/anvil)
    env: { ANVIL_BIN: process.env.ANVIL_BIN ?? "anvil" },
  },
});
