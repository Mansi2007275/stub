import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { arc, arcTestnet } from "viem/chains";
import { KNOWN_GOOD, RPC_URLS, makeTransport } from "./rpc";
import { NETWORK } from "./config";

// Both chains get a fallback transport, so one throttled endpoint never fails a purchase.
const transportFor = (network: "mainnet" | "testnet") => makeTransport(network === NETWORK ? RPC_URLS : KNOWN_GOOD[network]);

export const wagmiConfig = createConfig({
  chains: [arc, arcTestnet],
  connectors: [injected()],
  transports: {
    [arc.id]: transportFor("mainnet"),
    [arcTestnet.id]: transportFor("testnet"),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
