import { formatUnits } from "viem";
import { USDC_DECIMALS } from "./config";

export const shortHex = (h?: string, head = 6, tail = 4) =>
  !h ? "" : h.length <= head + tail + 2 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;

export const usdc = (units: bigint | number) =>
  Number(formatUnits(BigInt(units), USDC_DECIMALS)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });

export const STATUS = ["None", "Locked", "Fulfilled", "Refunded"] as const;
export type StatusName = (typeof STATUS)[number];
