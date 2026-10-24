# 3-minute video

0:00 Problem: APIs for agents need payment that only settles on delivery.
0:20 Arc Studio: show the workspace — contract review, test run (44 passing), testnet deploy, app preview.
1:00 Live app on mainnet: /try → type idea → approve → lock (show explorer tx) → sign → brief appears.
1:40 Receipt page: Released, 97/3 split, result hash. Open the fulfill tx on explorer.arc.io.
2:05 Agent budget: set 0.05 per call / 0.10 per day, agent buys twice, third call reverts OverDailyCap.
2:35 Safety: refund path after deadline, retry with same purchase ID never charges twice.
2:50 Close: what's next (more services, x402-style HTTP middleware, SDK).
