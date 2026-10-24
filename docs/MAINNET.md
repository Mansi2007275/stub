# Mainnet checklist (do these yourself, with small amounts)

Arc Studio deploys to testnet only, so mainnet is deployed with Foundry from your machine.

1. **Fund** `0x71aE…77ee` with ~2 USDC on Arc mainnet (gas is paid in USDC). Fund the fulfiller wallet with ~0.5 USDC.
2. **Import the deployer key into an encrypted keystore** (never paste it into files):
   ```bash
   cast wallet import stub-deployer --interactive
   ```
3. **Dry run** (no broadcast):
   ```bash
   forge script script/Deploy.s.sol --rpc-url https://rpc.mainnet.arc.io --account stub-deployer
   ```
4. **Deploy**:
   ```bash
   forge script script/Deploy.s.sol --rpc-url https://rpc.mainnet.arc.io --account stub-deployer --broadcast
   ```
   Copy the address from the output. Check on https://explorer.arc.io that `owner()`, `usdc()` and `feeBps()` are right.
5. **Register the service** from the merchant wallet (same as owner here): open the live site with `VITE_CHAIN=mainnet` and use `/merchant`, or
   ```bash
   VITE_ESCROW_ADDRESS=0x<mainnet> forge script script/Deploy.s.sol:RegisterService --rpc-url https://rpc.mainnet.arc.io --account stub-deployer --broadcast
   ```
6. **Vercel env** → `VITE_CHAIN=mainnet`, `VITE_ESCROW_ADDRESS=0x<mainnet>`, redeploy.
7. **One real paid call** on the live site (`/try`). Save the lock and release tx hashes.
8. Fill `docs/SUBMISSION.md` and record the evidence in `docs/PROGRESS.md`.

Expected cost: deployment + registration + one call ≈ well under 1 USDC in gas, plus the 0.05 USDC call itself (97% of which comes back to you as merchant).
