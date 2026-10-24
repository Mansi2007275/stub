/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN?: string;
  readonly VITE_ARC_TESTNET_RPC_URL?: string;
  readonly VITE_ARC_MAINNET_RPC_URL?: string;
  readonly VITE_USDC_ADDRESS?: string;
  readonly VITE_ESCROW_ADDRESS?: string;
  readonly VITE_SERVICE_ID?: string;
  readonly VITE_ESCROW_DEPLOY_BLOCK?: string;
  readonly VITE_API_BASE?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}
