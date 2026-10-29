import { useReadContract } from "wagmi";
import { ESCROW_ADDRESS, SERVICE_ID, chain, isDeployed } from "./config";
import { escrowAbi } from "./escrowAbi";

/**
 * The protocol fee as the contract currently reports it. Nothing in the UI may state a split as a
 * constant: the owner can change feeBps, so the pages render whatever the chain says.
 */
export function useFeeBps(): { feeBps?: number; sellerPct?: string; feePct?: string } {
  const { data } = useReadContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "feeBps", chainId: chain.id, query: { enabled: isDeployed } });
  if (data === undefined) return {};
  const feeBps = Number(data);
  const pct = (bps: number) => {
    const v = bps / 100;
    return `${Number.isInteger(v) ? v : v.toFixed(2)}%`;
  };
  return { feeBps, sellerPct: pct(10_000 - feeBps), feePct: pct(feeBps) };
}

/** The listed price of a service, straight from the escrow. */
export function useServicePrice(serviceId: bigint = SERVICE_ID): bigint | undefined {
  const { data } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "services",
    args: [serviceId],
    chainId: chain.id,
    query: { enabled: isDeployed },
  });
  return data?.[2];
}
