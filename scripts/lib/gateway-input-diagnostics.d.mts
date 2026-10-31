export const MAINNET_GATEWAY: "0x499b7494b08163d867286b31fF25Fcd1038e03Ae";
export function diagnoseGatewayInput(value: unknown, readerFailure?: string | null, expectedAddress?: string): {
  inputLength: number | null;
  prefixValid: boolean;
  hexValid: boolean;
  failureCategory: string;
};
