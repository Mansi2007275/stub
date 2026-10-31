import { parseGatewayKey } from "../../lib/server/gatewayKey.mjs";

export const MAINNET_GATEWAY = "0x499b7494b08163d867286b31fF25Fcd1038e03Ae";

/** Safe metadata only. Never returns an input fragment, address, error payload or key. */
export function diagnoseGatewayInput(value, readerFailure = null, expectedAddress = MAINNET_GATEWAY) {
  const text = typeof value === "string" ? value : null;
  const prefixValid = text !== null && text.startsWith("0x");
  const hex = text === null ? "" : prefixValid ? text.slice(2) : text;
  const result = {
    inputLength: text === null ? null : text.length,
    prefixValid,
    hexValid: /^[0-9a-fA-F]+$/.test(hex),
    failureCategory: readerFailure,
  };
  if (readerFailure) return result;
  if (text === null) result.failureCategory = "input_unavailable";
  else if (/[\uFEFF\u200B-\u200F\u2060]/.test(text)) result.failureCategory = "invisible_character";
  else if (text.trim() !== text) result.failureCategory = "surrounding_whitespace";
  else if (/^["']|["']$/.test(text)) result.failureCategory = "quoted_input";
  else if (!prefixValid) result.failureCategory = "invalid_prefix";
  else if (text.length !== 66) result.failureCategory = "invalid_length";
  else if (!result.hexValid) result.failureCategory = "invalid_hex";
  else {
    try {
      const address = parseGatewayKey(text).address;
      result.failureCategory = address.toLowerCase() === expectedAddress.toLowerCase() ? "none" : "address_mismatch";
    } catch { result.failureCategory = "invalid_scalar"; }
  }
  return result;
}
