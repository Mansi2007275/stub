import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { parseGatewayKey } from "../lib/server/gatewayKey.mjs";
import { readHiddenKeyResult } from "../scripts/lib/hidden-key-input.mjs";
import { diagnoseGatewayInput, MAINNET_GATEWAY } from "../scripts/lib/gateway-input-diagnostics.mjs";

// Synthetic scalar only. No .env, saved credential, clipboard or testnet gateway is accessed.
const synthetic = "0x" + "0".repeat(63) + "2";
const begin = "\x1b[200~";
const end = "\x1b[201~";

async function pasted(chunks: Array<string | Buffer>, endStream = false) {
  const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false, setRawMode: vi.fn() });
  const output = Object.assign(new PassThrough(), { isTTY: true });
  let displayed = "";
  output.on("data", chunk => { displayed += String(chunk); });
  const pending = readHiddenKeyResult(input, output);
  for (const chunk of chunks) input.write(chunk);
  if (endStream) input.end();
  const result = await pending;
  expect(displayed).toBe("Gateway private key (input hidden): \n");
  expect(displayed).not.toContain(synthetic);
  expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
  expect(input.listenerCount("data")).toBe(0);
  expect(input.listenerCount("end")).toBe(0);
  expect(input.listenerCount("error")).toBe(0);
  return result;
}

describe("Windows hidden paste and sanitized diagnostics", () => {
  it("uses the intended mainnet address only and treats a valid other account as a mismatch", async () => {
    expect(MAINNET_GATEWAY).toBe("0x499b7494b08163d867286b31fF25Fcd1038e03Ae");
    const entered = await pasted([synthetic + "\r\n"]);
    expect(parseGatewayKey(entered.value).address).toBeTruthy();
    expect(diagnoseGatewayInput(entered.value, entered.failureCategory)).toEqual({
      inputLength: 66, prefixValid: true, hexValid: true, failureCategory: "address_mismatch",
    });
  });

  it("distinguishes a synthetic expected-account match without any real key", () => {
    const syntheticAddress = parseGatewayKey(synthetic).address;
    expect(diagnoseGatewayInput(synthetic, null, syntheticAddress).failureCategory).toBe("none");
    expect(diagnoseGatewayInput(synthetic).failureCategory).toBe("address_mismatch");
  });

  it("handles a whole bracketed paste", async () => {
    const entered = await pasted([begin + synthetic + end + "\r"]);
    expect(entered.value === synthetic).toBe(true);
    expect(diagnoseGatewayInput(entered.value, entered.failureCategory).failureCategory).toBe("address_mismatch");
  });

  it("handles bracket markers and the payload split into arbitrary chunks", async () => {
    const entered = await pasted(["\x1b", "[2", "00~", synthetic.slice(0, 17), synthetic.slice(17), "\x1b[", "201", "~", "\r"]);
    expect(entered.value === synthetic).toBe(true);
    expect(entered.failureCategory).toBeNull();
  });

  it("handles every byte of a bracketed paste arriving separately", async () => {
    const entered = await pasted([...Buffer.from(begin + synthetic + end + "\r")].map(byte => Buffer.from([byte])));
    expect(entered.value === synthetic).toBe(true);
    expect(entered.failureCategory).toBeNull();
  });

  it("reports a literal Windows Ctrl+V as paste_not_delivered", async () => {
    const entered = await pasted(["\x16\r"]);
    expect(diagnoseGatewayInput(entered.value, entered.failureCategory)).toEqual({
      inputLength: 1, prefixValid: false, hexValid: false, failureCategory: "paste_not_delivered",
    });
  });

  it("does not silently strip a newline copied inside bracketed paste", async () => {
    const entered = await pasted([begin + synthetic + "\r\n" + end + "\r"]);
    const result = diagnoseGatewayInput(entered.value, entered.failureCategory);
    expect(result.inputLength).toBe(68);
    expect(result.failureCategory).toBe("surrounding_whitespace");
  });

  it("preserves a UTF-8 BOM even when its bytes arrive separately", async () => {
    const entered = await pasted([...Buffer.from(begin + "\uFEFF" + synthetic + end + "\r")].map(byte => Buffer.from([byte])));
    expect(diagnoseGatewayInput(entered.value, entered.failureCategory)).toEqual({
      inputLength: 67, prefixValid: false, hexValid: false, failureCategory: "invisible_character",
    });
  });

  it("classifies unknown terminal escapes instead of removing them", async () => {
    const entered = await pasted(["\x1b[D" + synthetic + "\r"]);
    expect(entered.failureCategory).toBe("unsupported_terminal_sequence");
  });

  it("reports an incomplete bracketed paste safely", async () => {
    const entered = await pasted([begin + synthetic], true);
    expect(entered.failureCategory).toBe("incomplete_bracketed_paste");
    expect(diagnoseGatewayInput(entered.value, entered.failureCategory).failureCategory).toBe("incomplete_bracketed_paste");
  });

  it.each([
    ["0".repeat(64), 64, false, true, "invalid_prefix"],
    ["0x" + "a".repeat(63), 65, true, true, "invalid_length"],
    ["0x" + "g".repeat(64), 66, true, false, "invalid_hex"],
    ["0x" + "0".repeat(64), 66, true, true, "invalid_scalar"],
    ["0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141", 66, true, true, "invalid_scalar"],
    ["\"" + synthetic + "\"", 68, false, false, "quoted_input"],
    [" " + synthetic, 67, false, false, "surrounding_whitespace"],
    [synthetic + "\u200B", 67, true, false, "invisible_character"],
  ])("emits metadata only for synthetic format/scalar case %#", (value, inputLength, prefixValid, hexValid, failureCategory) => {
    const result = diagnoseGatewayInput(value);
    expect(result).toEqual({ inputLength, prefixValid, hexValid, failureCategory });
    expect(Object.keys(result)).toEqual(["inputLength", "prefixValid", "hexValid", "failureCategory"]);
    expect(JSON.stringify(result)).not.toContain(synthetic);
  });

  it("distinguishes a non-interactive terminal from malformed key text", async () => {
    const result = spawnSync(process.execPath, ["scripts/diagnose-gateway-key.mjs"], { input: synthetic, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ inputLength: null, prefixValid: false, hexValid: false, failureCategory: "non_interactive_terminal" });
  });
});
