# Deck Builder

A separate app that **buys** a pitch brief from Stub and turns it into a deck. It is Stub's first real consumer
(the role ComputeQuest had in the original plan, rebuilt cleanly).

- Pays from a **bounded agent budget**: the owner wallet sets per-call and daily caps on-chain, and Deck Builder's
  agent key spends inside them via `payAsAgent`. It can't spend more, and refunds go back to the owner.
- The purchased brief is the **factual basis** of the deck (`geminiDeck` puts it in the system prompt; `templateDeck`
  builds the slides directly from it). Each job records `purchaseId`, lock tx, release tx and result hash.
- **Feature flag:** `USE_STUB=false` generates straight from the idea, with no chain calls and no USDC.
- **Idempotent jobs:** re-running the same job id never buys twice and never regenerates a finished deck.

```bash
# local chain, no keys needed
npm run demo:deck -- --local "A marketplace where small clinics rent idle MRI time to each other"

# against your deployed Stub (testnet or mainnet)
STUB_API=https://<site>.vercel.app/api STUB_ESCROW=0x… STUB_CHAIN=testnet \
DECK_AGENT_PRIVATE_KEY=0x… DECK_OWNER_ADDRESS=0x… \
npm run demo:deck -- "your idea"
```

Output: `out/deck-<job>.json` and `out/deck-<job>.html`.
