# Demos

| Script | Demo | What it shows |
|---|---|---|
| `npm run demo:a -- --local` | A | standalone buyer: pay → result → escrow released |
| `npm run demo:agent -- --local` | — | agent budget: 2 buys succeed, the 3rd hits `OverDailyCap` |
| `npm run demo:c -- --local` | C | unpaid denied · lost response retried with no 2nd charge · provider outage refunded |
| `npm run demo:deck -- --local "idea"` | B | Deck Builder buys a brief with its agent budget and builds a deck (`out/deck-*.html`) |
| `USE_STUB=false npm run demo:deck -- --local "idea"` | B | same app with the feature flag off: no purchase |
| `npm run demo:local` | all | runs every demo in sequence |

`--local` starts a throwaway anvil chain and the real gateway code. It needs Foundry's `anvil` on PATH (or `ANVIL_BIN`). Output is **local-chain evidence only**.

## Against your deployed Stub (testnet / mainnet)
Set in your shell (never commit):
```
STUB_API=https://<site>.vercel.app/api
STUB_ESCROW=0x9777da550470de0508d02d34b2c12b95e49c10a5
STUB_CHAIN=testnet            # or mainnet
BUYER_PRIVATE_KEY=0x…         # a small demo wallet with a little USDC
AGENT_PRIVATE_KEY=0x…         # for demo:agent / demo:deck
DECK_OWNER_ADDRESS=0x…        # wallet that set the agent's budget on /agents
```
Then run the same commands without `--local`.
