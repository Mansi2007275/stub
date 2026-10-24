# Security model and known limitations

**Unaudited. Use small amounts.** Neither Arc nor Circle audits submissions.

## What the contract guarantees
- Funds sit in escrow only per purchase; `balanceOf(escrow) == totalLocked` (invariant-tested).
- A purchase id is single-use forever; amount, fee, merchant and fulfiller are fixed at lock.
- Only the snapshotted fulfiller can release, and only before the deadline.
- Refunds always go to the payer. Agents can't redirect funds or exceed their caps.
- Pause blocks new locks only; release and refund keep working.
- The owner can rescue only USDC above `totalLocked`; ownership can't be renounced; transfer is 2-step.

## Trust assumptions
- **The fulfiller is trusted to deliver honestly.** It could post a hash of a useless result and get paid. The result hash makes the delivery auditable, not correct. Mitigation: merchant reputation; future: buyer dispute window or ERC-8004 validation.
- **The merchant chooses the fulfiller key.** A merchant can rotate it for future purchases only.
- **Gemini output is untrusted text.** It's schema-validated and rendered as text, never HTML.

## Operational rules
- Fulfiller hot wallet holds < $1 USDC (gas only). Its key lives only in Vercel env.
- `VITE_*` vars are public. No secret ever uses that prefix.
- If USDC blocklists a payer, its refund transfer reverts and that purchase stays locked.
- Rate limit (20/min/IP) is best-effort; behind shared NATs users may share a bucket.

## Incident: ComputeQuest repository
`Anand-0038/computequest` contains obfuscated payloads (`api.js`, `postcss.config.mjs`) that run on `dev/build/start`. It was not executed or used. Anyone who ran it should move funds from a clean device and rotate every key and token that was on that machine.
