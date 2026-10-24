# Stub

**Charge per API call. Get paid when the answer arrives.**

Stub is USDC escrow for API calls and AI agents on Arc. A buyer locks USDC for one call, the seller's gateway delivers the result and posts its hash, and the escrow releases payment (97% seller, 3% protocol). If nothing is delivered before the deadline, the buyer takes the money back. Owners can give AI agents a spending budget that the contract enforces.

Built for **Arc Microgrants: Built with Arc Studio**.

---

## What works today

| Part | Status | Evidence |
|---|---|---|
| `StubEscrow.sol` | done | 45 Foundry tests (unit, fuzz, invariants) |
| Gateway `/api/call` | done | 11 end-to-end tests on a local chain (real contract + txs + signatures; Gemini/Redis faked) |
| Try page (approve → lock → sign → generate → release) | done | builds, renders; needs a wallet on testnet to run for real |
| Agent budgets page | done | `setAgentBudget`, allowance, live spend meter |
| Merchant page | done | `registerService`, earnings from events |
| Receipt page | done | reads `getPurchase`, refund button after deadline |
| Buyer SDK (`packages/sdk`) | done | 17 local e2e tests |
| Deck Builder consumer (`apps/deck-builder`) | done | buys a brief with an agent budget, builds a deck; flag-off mode |
| Demos A / B / C | done | `examples/README.md` |
| Live ticket wall + `/api/feed` | done | chunked (5k-block) incremental event scan, Redis cursor |
| `@stub/paywall` (sell any function) | done | second seller demo + 4 tests |
| Receipt verify + share, agent punch card + revoke + ERC-8004 badge, `/deck` page | done | real-browser e2e |
| Docs | done | `docs/` research, architecture, requirements, risks, security, mainnet |
| Arc Studio workspace | contracts reviewed, tested, testnet-deployed there | docs/PROGRESS.md |
| Testnet deploy | done | `0x9777da550470de0508d02d34b2c12b95e49c10a5` |
| Mainnet deploy | pending | fill `docs/SUBMISSION.md` from real tool output |

Local-chain tests are **not** testnet or mainnet evidence.

```
contracts/StubEscrow.sol     escrow contract (OpenZeppelin 5.1, solc 0.8.28)
test/                        Foundry tests
tests/gateway.e2e.test.ts    gateway end-to-end on anvil
script/Deploy.s.sol          Deploy + RegisterService
src/                         Vite + React app
api/                         Vercel functions: health, services, quote, call, purchase/[id]
lib/server/                  gateway core, Gemini, Redis, env validation
shared/protocol.ts           input hash + signed message format (client and server)
docs/arc-studio/             prompts to run the build inside Arc Studio
docs/SUBMISSION.md           DoraHacks fields
docs/DEMO_SCRIPT.md          3-minute video plan
```

## How a paid call works

1. `POST /api/quote` returns a fresh `purchaseId` and the price.
2. Buyer approves USDC and calls `pay(serviceId, purchaseId, keccak256(input), maxAmount)`.
3. Buyer signs `Stub call authorization / purchase / input` (EIP-191, no gas).
4. `POST /api/call` checks, in order: purchase exists and is Locked, right service and gateway, input hash matches, signature is the payer's or their agent's, deadline not too close. It takes a Redis lock, runs Gemini, stores the result, then calls `fulfill(purchaseId, keccak256(result))`.
5. If Gemini fails, the gateway calls `refundEarly` immediately.
6. Retrying with the same `purchaseId` returns the stored result and never charges again.

## Contract guarantees

| Guarantee | How |
|---|---|
| A purchase ID works once | `PurchaseExists` on any reuse, even after settlement |
| Price can't change after you pay | amount, fee, merchant and fulfiller are snapshotted at lock |
| Buyer protected from price front-run | `maxAmount` parameter on `pay` |
| Late delivery can't release funds | `fulfill` reverts after the deadline |
| Refunds always go to the payer | even when an agent made the call |
| Agents can't exceed limits | per-call + daily cap, checked on-chain, failed calls don't burn budget |
| Pause can't trap funds | pause blocks new locks only, fulfil and refund always work |
| No accounting drift | `totalLocked` == escrow balance, proven by invariant tests |
| Short-delivering tokens rejected | balance-delta check on every lock |
| Owner can't touch escrow | `rescue` only sends USDC above `totalLocked`; renounce disabled; 2-step ownership |

Arc specifics handled: USDC ERC-20 interface at `0x3600…0000` with **6 decimals** (never the 18-decimal native unit), no `address(0)` transfers.

---

## Your step-by-step build plan

> **Arc Studio rule:** projects built outside Arc Studio are not eligible. This repo is the starting point. Upload it into Arc Studio and do the testing, testnet deploy and app iteration **there**, so the Arc Studio project shows contracts, tests and app.

### Step 1 — Run locally
```bash
npm install
npm run setup:contracts     # fetches OpenZeppelin v5.1.0 + forge-std into lib/
npm run test:contracts      # needs Foundry: forge test → 44 passing
npm run dev                 # http://localhost:5173
```

### Step 2 — Move into Arc Studio + testnet deploy
```bash
npm install -g @circle-fin/arc-studio-cli
arc-studio login
arc-studio run "Review and test this Stub escrow, then deploy it to Arc testnet with USDC 0x3600000000000000000000000000000000000000" \
  --session stub \
  --file contracts/StubEscrow.sol:contracts/StubEscrow.sol \
  --file test/StubEscrow.t.sol:test/StubEscrow.t.sol \
  --file test/mocks/MockUSDC.sol:test/mocks/MockUSDC.sol \
  --output json
arc-studio deployments      # copy the testnet address
arc-studio open             # this URL is your Arc Studio project URL for DoraHacks
```
Put the address in `.env` → `VITE_ESCROW_ADDRESS`. Then register the service from your merchant wallet:
```bash
arc-forge script script/Deploy.s.sol:RegisterService --rpc-url arc_testnet --account merchant --broadcast
```

### Step 3 — App in Arc Studio
Run `docs/arc-studio/02-app.md` in the same Arc Studio session, test every page in the live preview with faucet USDC, then push to GitHub from Arc Studio.

### Step 4 — Mainnet (only with small amounts)
```bash
arc-cast wallet import deployer --interactive      # encrypted keystore, never a raw key in files
arc-forge script script/Deploy.s.sol --rpc-url arc --account deployer --broadcast
```
Set `VITE_CHAIN=mainnet` + mainnet `VITE_ESCROW_ADDRESS`, register the service on mainnet, run one paid call from the live site.

### Step 5 — Vercel + submit
Import the GitHub repo in Vercel, add the env vars (secrets only in Vercel, never `VITE_*`), deploy. Submit on DoraHacks with: Arc Studio URL, live link, contract address, tx hash on explorer.arc.io, repo, video.

---

## Wallets you need

| Role | Address | Notes |
|---|---|---|
| Owner / fee recipient / merchant | `0x71aEE14669EaF0a2f55b783Eed64Ad12B66177ee` | your main wallet |
| Fulfiller (gateway) | create a **new** wallet | its key goes in Vercel as `FULFILLER_PRIVATE_KEY`; keep under $1 USDC |
| Buyer (for demo) | any second wallet | a few cents of USDC |

## Keys you need

| Key | Where | Goes in |
|---|---|---|
| Gemini API key | aistudio.google.com/apikey | `GEMINI_API_KEY` (server only) |
| Upstash Redis | Vercel → Storage → Upstash | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| Fulfiller private key | the new hot wallet | `FULFILLER_PRIVATE_KEY` (server only) |
| Testnet USDC | faucet.circle.com | — |

## Security notes

- Unaudited. Use small amounts.
- The fulfiller is trusted to deliver honestly; the contract guarantees it can't take funds after the deadline or release to anyone but the snapshotted merchant.
- If a payer address gets blocklisted by USDC, its refund transfer would revert and that purchase stays locked.
