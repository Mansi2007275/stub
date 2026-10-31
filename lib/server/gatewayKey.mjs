import { privateKeyToAccount } from "viem/accounts";

/** Deliberately discards viem errors: they may contain input and must never cross a log boundary. */
export class GatewayKeyError extends Error {
  constructor(code) {
    super(code);
    this.name = "GatewayKeyError";
    this.code = code;
  }
}

/** Strict, identical parsing for health, signing, and the offline interactive validator. */
export function parseGatewayKey(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new GatewayKeyError("invalid_format");
  }
  try {
    // viem/noble enforces 1 <= scalar < secp256k1 order. Do not trim or alter the key.
    return privateKeyToAccount(value);
  } catch {
    throw new GatewayKeyError("invalid_scalar");
  }
}

export function isGatewayKey(value) {
  try { parseGatewayKey(value); return true; } catch { return false; }
}
