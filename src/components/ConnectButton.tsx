import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { chain } from "../lib/config";
import { shortHex } from "../lib/format";

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (isConnected && chainId !== chain.id) {
    return (
      <button className="btn small" onClick={() => switchChain({ chainId: chain.id })}>
        Switch to {chain.name}
      </button>
    );
  }

  if (isConnected) {
    return (
      <button className="btn small ghost mono" onClick={() => disconnect()} title="Disconnect">
        {shortHex(address)}
      </button>
    );
  }

  const injected = connectors[0];
  return (
    <button
      className="btn small"
      disabled={!injected || isPending}
      onClick={() => injected && connect({ connector: injected, chainId: chain.id })}
      title={error?.message}
    >
      {isPending ? "Connecting" : "Connect wallet"}
    </button>
  );
}
