# Risk register

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | Project judged "not built in Arc Studio" | Med | Fatal | Contracts reviewed, tested, deployed in Arc Studio; app built there; push to GitHub **from Arc Studio**; show it in the video | Mansi |
| 2 | No mainnet tx before deadline | Med | Fatal | Mainnet checklist in `docs/MAINNET.md`; do testnet paid call first; submit early | Mansi |
| 3 | Fulfiller key leak | Low | Low (≤ $1) | Separate hot wallet, minimal balance, Vercel-only secret | Mansi |
| 4 | Gemini model id deprecated | Med | Med | `GEMINI_MODEL` env; failure triggers instant refund, not lost funds | Mansi |
| 5 | Vercel function timeout during generation | Low | Low | `maxDuration 60`, 25 s provider timeout, result cached before fulfil | code |
| 6 | Upstash outage | Low | Med | Chain stays source of truth; buyer refunds after deadline | code |
| 7 | Contract bug | Low | High | 45 unit/fuzz/invariant tests, Arc Studio review, small amounts | code |
| 8 | Malicious ComputeQuest repo run on a dev machine | — | High | Not used; warning in SECURITY.md; rotate keys if ever run | Mansi |
| 9 | Arc Studio CLI token exposure | Happened (shared in chat) | Med | Old token revoked; revoke current one after the hackathon | Mansi |
