Build the Stub web app in this workspace around the StubEscrow contract you deployed to Arc Testnet at 0x9777da550470de0508d02d34b2c12b95e49c10a5.

The uploaded files are the app source (React + Vite + wagmi + viem + react-router). They land at their real paths:
- index.html, public/favicon.svg
- src/** (pages: Home, Try, Agents, Merchant, Receipt; design system in src/styles/global.css)
- shared/protocol.ts (input hash + signed message format, used by app and API)
- api/** and lib/server/** (Vercel serverless functions: health, services, quote, call, purchase/[id]; gateway core in lib/server/callCore.ts)
- vercel.json, tsconfig.app.json, tsconfig.api.json, scripts/export-abi.mjs

Please:
1. Integrate these into the sandbox app. Keep the existing design exactly (fonts Bricolage Grotesque + IBM Plex, navy/USDC-blue "security paper" look). Do not replace it with a template.
2. Install what's missing: react-router-dom@7, wagmi@2, viem@2, @tanstack/react-query@5, zod@3, @upstash/redis, and dev deps @vercel/node, @types/node.
3. Regenerate src/lib/escrowAbi.ts and lib/server/escrowAbi.ts from the compiled StubEscrow ABI (it now includes DailyCapBelowPerCall).
4. Set non-secret env for the preview: VITE_CHAIN=testnet, VITE_ESCROW_ADDRESS=0x9777da550470de0508d02d34b2c12b95e49c10a5, VITE_USDC_ADDRESS=0x3600000000000000000000000000000000000000, VITE_SERVICE_ID=1, VITE_API_BASE=/api. Never put private keys in VITE_ vars.
5. Make sure TypeScript and the Vite build pass, and the live preview loads every route (/, /try, /agents, /merchant, /receipt/<any 32-byte hex>) without runtime errors.
6. Note: /api/* are Vercel functions and need server secrets (FULFILLER_PRIVATE_KEY, GEMINI_API_KEY, UPSTASH_*), so the /try "generate" step only works once deployed to Vercel. The on-chain parts (register service, set agent budget, approve, pay, receipt, refund) must work directly from the preview with a connected wallet.
7. Update AGENTS.md with what you built and anything I still need to do.
Do not deploy to mainnet.
