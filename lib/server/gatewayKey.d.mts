import type { privateKeyToAccount } from "viem/accounts";
export class GatewayKeyError extends Error {
  readonly code: "invalid_format" | "invalid_scalar";
  constructor(code: "invalid_format" | "invalid_scalar");
}
export function parseGatewayKey(value: unknown): ReturnType<typeof privateKeyToAccount>;
export function isGatewayKey(value: unknown): boolean;
