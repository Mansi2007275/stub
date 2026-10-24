# Stub — DoraHacks submission (fill in from real tool output only)

| Field | Value |
|---|---|
| Arc Studio project URL | https://studio.arc.io/app/618a850a-ca69-4746-8dbf-2a60cb9d45cd |
| Live app | `https://….vercel.app` |
| StubEscrow (Arc mainnet) | `0x…` → https://explorer.arc.io/address/0x… |
| Example USDC tx (mainnet) | `0x…` → https://explorer.arc.io/tx/0x… |
| Public repo | `https://github.com/Mansi2007275/stub` |
| Video | `https://…` |
| Builder profile | https://github.com/Mansi2007275 · https://x.com/0xmansiyadav |

## Short description (≈150 words)

Stub is USDC escrow for pay-per-call APIs and AI agents on Arc. A buyer locks the exact price for one call against a single-use purchase ID and a hash of their input. The seller's gateway runs the request and posts a hash of the result; the escrow then releases 97% to the seller and 3% to the protocol in the same transaction. If nothing is delivered before the deadline, the buyer takes the full amount back, and a failing provider refunds instantly. Owners can give an AI agent a budget — a per-call and daily limit enforced by the contract — so agents can buy services without holding the wallet. The first live service is a pitch-brief analyzer.

How Arc Studio was used: (write what actually happened — e.g. Arc Studio reviewed and tested StubEscrow, deployed it to Arc testnet, built and iterated the app in the live preview with faucet USDC, and pushed the repo to GitHub.)
