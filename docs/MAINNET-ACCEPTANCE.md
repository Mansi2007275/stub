# Mainnet acceptance results

No acceptance execution remains authorized. Do not rerun historical operator scripts or spend
unused budget. Current verification used only public chain reads, authenticated supported health
checks, free browser behavior and isolated local-chain tests.

## Evidence scope

- **Stable production:** https://stub-mainnet.vercel.app . Fresh configuration, health, routes/assets,
  anonymous access and free Deck checks are in [MAINNET.md](MAINNET.md). No new paid flow was run there.
- **Protected acceptance build:** https://stub-mainnet-cxejvoo4o-mansi2007275s-projects.vercel.app ,
  deployment dpl_9bxRrQiL2c5NtjX4LELHbWTSiqFy. The historical controlled failure/paid Deck UI checks
  used real Arc mainnet funds and real Gemini for the successful brief, separate Redis key namespace
  and fixed allowlisted IDs. It was not promoted to production. Failure injection was private.
- **Local tests:** isolated Anvil contracts and deterministic provider fixtures. These validate
  bounded request execution/recovery but are not live mainnet receipt-lag or production UI evidence.

## Completed mainnet checks

| Check | Result and evidence |
|---|---|
| Successful existing 0.01 call / payment split | PASSED on chain, merchant 9700 / protocol 300; original returned-result verification remains untested |
| Phase A timeout refund | PASSED: [refund](https://explorer.arc.io/tx/0x82b219fbd3ba46aa9065cb969121a02a372fe1eca321cdd15ea20c479289fb90), 0.01 USDC returned, gas 0.001313445, early=false |
| Original Phase A resume | UNTESTED: original_input_unavailable, zero transactions; no replacement purchase |
| Phase B controlled provider failure / early refund | PASSED on protected build: HTTP 502 provider_failed with controlled failure detail, confirmed refund, payer balance +0.01, UI agreement |
| Phase B paid Deck | PASSED on protected build: real Gemini brief, canonical hash, ten slides from purchased brief, correctly labelled HTML download, linked receipt Released |
| Phase B signed cached replay | PASSED on protected build with identical result/hash and unchanged wallet nonces |
| Fresh free Deck | PASSED on stable production, disconnected wallet and no paid requests |

[Phase A refund receipt](mainnet-phase-a-refund.json), [Phase A resume output](mainnet-phase-a-resume.json),
[Phase B chain receipts](mainnet-phase-b-results.json), [Phase B UI results](mainnet-phase-b-ui-results.json).
Fresh receipt/state rechecks: [final chain report](mainnet-final-verification.json). A past UI result
is not represented as a freshly repeated paid check.

Original successful purchase:
0xf443864a685b8da171a5b785a703a508a37350bdb46eb00d1214f59d5ee7beea.
Original timeout purchase:
0x0120fe5355e621167bce7204e6af88312a5166df43f37aa501961a29d09bfccb.
Controlled-failure purchase:
0x12be25cbceb8d1d1ac59a8d3147955b52fa2dae272ba07ea9dedcc57567b18de.
Paid-Deck purchase:
0x6c5eb86fa0e57a1b9930e4629f0ccb98ab9961208ee5270fef4cf6c720d7c5b2.

## Actual Phase B spending

| Operation | Transaction | Gas USDC |
|---|---|---:|
| approve | [0xee32131c?](https://explorer.arc.io/tx/0xee32131cef09de31e256e34857532d44820cfd9f213c0fa875ead71781f97d35) | 0.001163946 |
| pay:early_refund | [0x0fe19fa4?](https://explorer.arc.io/tx/0x0fe19fa4672b4219cdd0939e60fac828dd38a11e0271d1a93df53f0fddea3750) | 0.004459161 |
| pay:paid_deck | [0xa45e9fbd?](https://explorer.arc.io/tx/0xa45e9fbdfc46daced01639e0f89a1f608cdf1278cd5091e0e9b46b07268ff270) | 0.004358361 |
| refundEarly | [0xf887d639?](https://explorer.arc.io/tx/0xf887d6398d022a1f852a78582119fb4486e3cf96589131454eb236e902bce2cc) | 0.001491924 |
| fulfill | [0xd4346675?](https://explorer.arc.io/tx/0xd434667594639bef91a5d03af81a711aa62b82f05f90a8069efdef2acd8623f3) | 0.002274111 |

One finite 20000-unit approval, two 10000-unit payments, one refundEarly and one fulfil.
Full principal debits **0.02 USDC**; gas **0.013747503**; gross **0.033747503** against the
**0.0536** additional ceiling. Accounting headroom **0.019852497** is not spending authorization.
All transaction caps were respected. No refund or merchant/protocol revenue reduces gross.
Merchant and protocol recipients coincide; the event's 9700/300 amounts establish the split.
Paid result hash: 0x0953633c6175f85c66ffba286a71d641fcd4f74fdc4933955eb0b56cdcf430fd.

## Recovery and remaining gaps

- Original successful-purchase result/hash and resume: **UNTESTED**, original input unavailable.
  Do not reconstruct it with another paid call.
- Live pre-deadline refund rejection and natural receipt-lag/pending UI behavior: **UNTESTED**.
  Fast confirmed receipts cannot prove these timing cases. Existing local tests cover early
  rejection, hung RPC/Redis, bounded generation, uncertain sends, pending fulfil/refund and
  eventual same-purchase recovery without another settlement send.
- Fresh-instance interrupted Deck recovery with persistent pending storage and original input:
  **PASSED locally**. The test loses an actual local gateway response after fulfil, recreates
  Deck/SDK instances, and confirms the same purchase with no new wallet nonce/balance/provider work.
  It models reload state loss; no live browser paid reload was performed.
- Completed Deck full-reload persistence: **UNSUPPORTED**, not claimed passed. Local test confirms
  a fresh in-memory job store plus cleared completed SDK pending state attempts a new quote,
  then deliberately blocks before any second payment. No product persistence change was made.
- Stable-production paid Deck/early failure/replay were not newly exercised in this run; the
  protected build's passes do not establish stable-hostname paid behavior.
- Explorer source publication: consult the fresh browser report and current MAINNET.md gate.

The [manifest](mainnet-acceptance-manifest.json) retains historical inputs/caps for mocked guard
regressions, records completed spending and closes execution. It is not permission to fund tests.
Production source does not contain the controlled failure mechanism. No production aliases,
models, environment values, access policy, testnet configuration, domains or contracts changed.
