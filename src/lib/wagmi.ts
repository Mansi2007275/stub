import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { arc, arcTestnet } from "viem/chains";

const env = import.meta.env;

export const wagmiConfig = createConfig({
  chains: [arc, arcTestnet],
  connectors: [injected()],
  transports: {
    [arc.id]: http(env.VITE_ARC_MAINNET_RPC_URL || "https://rpc.mainnet.arc.io"),
    [arcTestnet.id]: http(env.VITE_ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.io"),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
