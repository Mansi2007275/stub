Project: Stub — USDC escrow for pay-per-call APIs and AI agents on Arc.

The uploaded files are the starting point:
- contracts/StubEscrow.sol (escrow: lock → fulfill → release 97/3, refund after deadline, refundEarly by merchant/fulfiller, agent budgets with per-call and daily caps, pause, rescue of excess only)
- test/StubEscrow.t.sol, test/StubEscrow.invariant.t.sol, test/mocks/MockUSDC.sol (44 Foundry tests incl. fuzz + invariants)

Please:
1. Review StubEscrow.sol for security issues specific to Arc (USDC ERC-20 interface at 0x3600000000000000000000000000000000000000 uses 6 decimals; native gas USDC is 18 decimals and must never be mixed in; transfers to address(0) revert). Report findings and fix any real issue.
2. Run the full Foundry test suite and show the results. Add tests for anything you fix.
3. Deploy StubEscrow to Arc testnet with constructor args:
   usdc = 0x3600000000000000000000000000000000000000
   owner = 0x71aEE14669EaF0a2f55b783Eed64Ad12B66177ee
   feeRecipient = 0x71aEE14669EaF0a2f55b783Eed64Ad12B66177ee
   feeBps = 300
4. Report the deployed address, explorer link and transaction hash.
Do not deploy to mainnet.
