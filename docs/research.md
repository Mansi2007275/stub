# Research — verified facts

Accessed 2026-10-23 / 2026-10-24. Primary sources only. Re-check before mainnet.

## Arc network
| Fact | Value | Source |
|---|---|---|
| Mainnet chain ID | 5042 | [Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc.md) |
| Mainnet RPC | https://rpc.mainnet.arc.io | same |
| Mainnet explorer | https://explorer.arc.io | same |
| Testnet chain ID | 5042002 | same |
| Testnet RPC / explorer | https://rpc.testnet.arc.io · https://explorer.testnet.arc.io | same |
| Testnet faucet | https://faucet.circle.com | same |
| viem chains | `arc`, `arcTestnet` from `viem/chains` | same |
| Gas token | USDC (native, 18 decimals) | [docs.arc.io agent instructions](https://docs.arc.io/llms.txt) |
| USDC ERC-20 interface | `0x3600000000000000000000000000000000000000`, **6 decimals**, same balance as native | [Contract addresses](https://docs.arc.io/arc/references/contract-addresses.md) |
| Fee floor | mempool enforces 20 gwei `maxFeePerGas` | [llms.txt](https://docs.arc.io/llms.txt) |
| `address(0)` sends | revert | same |
| Finality | deterministic, < 1 s | same |
| ERC-8183 (agentic commerce escrow) | reference implementation on **testnet only** `0x0747…4583` | [Contract addresses](https://docs.arc.io/arc/references/contract-addresses.md) |
| ERC-8004 identity registry (mainnet) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | same |

Decision: StubEscrow uses **only** the 6-decimal ERC-20 interface and never `msg.value`, so the two USDC representations can't be mixed.

## Arc Studio
| Fact | Source |
|---|---|
| Builds/deploys full-stack apps; deploys to **Arc testnet only**, never signs mainnet txs for you | [Arc Studio](https://docs.arc.io/ai/arc-studio.md), [crypto.news](https://crypto.news/circle-launches-arc-studio-ai-agent-for-building-onchain-apps/) |
| CLI `@circle-fin/arc-studio-cli`: `login`, `run`, `pull`, `apps`, `deployments`, `open`; drivable from Claude Code | [Arc Studio CLI](https://docs.arc.io/ai/arc-studio-cli.md) |
| Can push to GitHub and deploy to Vercel/Netlify via Integrations | Arc Studio turn output, 2026-10-24 |

Consequence: mainnet deployment is done by the builder with Arc Foundry / `arc-forge` after testing in Arc Studio.

## Competition (DoraHacks, "Arc Microgrants: Built with Arc Studio")
- Deadline 2026-11-02 10:29 IST (page) / "Submissions close November 1, 2026" (text). Reviewed on arrival.
- Must ship: contracts written **and tested in Arc Studio**, deployed to **Arc mainnet**; app built in Arc Studio at a public link; ≥1 mainnet tx moving USDC through contract and app.
- Submission: Arc Studio project URL, live link, contract address + tx hash on explorer.arc.io, public repo, video, description, builder profile.
- Not eligible: built outside Arc Studio, testnet-only, mockups, already-funded work. Work must be yours.
- Scoring: real mainnet USDC 30% · Arc Studio usage 25% · working product 25% · potential 20%.

## x402
Not adopted. Stub needs **conditional** settlement (release on delivery, refund on timeout), which a pay-then-serve HTTP 402 flow doesn't express. A 402-style middleware on top of StubEscrow is listed as future work.

## Naming
"ArcGate" was generic and close to Arc's own branding. Renamed to **Stub** (the tear-off stub of an escrow ticket). Final trademark/domain check is the builder's.

## ComputeQuest (`Anand-0038/computequest`)
Inspected 2026-10-24 **without executing anything**. Commit `a152135` ("Add GA4 page analytics", 2026-09-01) added:
- `api.js` — 28 KB obfuscated JavaScript hidden behind leading whitespace.
- `package.json` — `dev`, `build`, `start` changed to run `node api.js` first.
- `postcss.config.mjs` — a second obfuscated payload appended after ~12,000 tabs; exposes `require` globally and executes decoded code via the `Function` constructor. Next.js loads this file automatically, so removing `api.js` alone doesn't neutralise it.

This matches known supply-chain lures targeting developers' wallets and secrets. The repo was not used. Its intended role (first consumer of Stub, §7) is fulfilled by `apps/deck-builder`, written from scratch.
