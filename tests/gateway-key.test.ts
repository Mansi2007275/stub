import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { GatewayKeyError, isGatewayKey, parseGatewayKey } from "../lib/server/gatewayKey.mjs";
import { readHiddenKey } from "../scripts/lib/hidden-key-input.mjs";
import { ConfigError, secretEnv } from "../lib/server/env";

afterEach(() => vi.unstubAllEnvs());

// Public test vector only. No environment variable or user credential is read by this suite.
const key = `0x${"0".repeat(63)}1`;
const order = "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141";

describe("shared strict gateway-key parser", () => {
  it("derives the same known public address as viem", () => {
    expect(parseGatewayKey(key).address).toBe("0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf");
    expect(parseGatewayKey(key).address).toBe(privateKeyToAccount(key as `0x${string}`).address);
    expect(isGatewayKey(key)).toBe(true);
  });

  it("closes viem's unchecked-prefix gap", () => {
    const wrongPrefix = `zz${key.slice(2)}`;
    // The former health implementation accepted this because viem unconditionally slices(2).
    expect(privateKeyToAccount(wrongPrefix as `0x${string}`).address).toBe(parseGatewayKey(key).address);
    expect(isGatewayKey(wrongPrefix)).toBe(false);
  });

  it.each([undefined, null, "", key.slice(2), ` ${key}`, `${key}\n`, `"${key}"`, "0X" + key.slice(2), key.slice(0, -1), key + "1", "0x" + "g".repeat(64)])("rejects malformed input safely (case %#)", value => {
    expect(isGatewayKey(value)).toBe(false);
    try { parseGatewayKey(value); throw new Error("expected rejection"); }
    catch (error) {
      expect(error).toBeInstanceOf(GatewayKeyError);
      expect((error as GatewayKeyError).code).toBe("invalid_format");
      expect((error as Error).message).toBe("invalid_format");
      expect((error as Error).cause).toBeUndefined();
    }
  });

  it.each(["0x" + "0".repeat(64), order, "0x" + "f".repeat(64)])("rejects zero and out-of-range scalars safely (case %#)", value => {
    expect(isGatewayKey(value)).toBe(false);
    try { parseGatewayKey(value); throw new Error("expected rejection"); }
    catch (error) {
      expect(error).toBeInstanceOf(GatewayKeyError);
      expect((error as Error).message).toBe("invalid_scalar");
      expect((error as Error).cause).toBeUndefined();
      expect(String(error)).not.toContain(value);
    }
  });

  it("accepts the largest valid scalar", () => {
    expect(isGatewayKey("0x" + (BigInt(order) - 1n).toString(16))).toBe(true);
  });

  it("applies scalar validation at the server environment boundary too", () => {
    vi.stubEnv("GEMINI_API_KEY", "public-test-value-only");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "public-test-value-only");
    vi.stubEnv("FULFILLER_PRIVATE_KEY", key);
    expect(secretEnv().FULFILLER_PRIVATE_KEY).toBe(key);
    vi.stubEnv("FULFILLER_PRIVATE_KEY", order);
    expect(secretEnv).toThrow(ConfigError);
    try { secretEnv(); } catch (error) {
      expect((error as Error).message).toContain("FULFILLER_PRIVATE_KEY");
      expect((error as Error).message).not.toContain(order);
    }
  });
});

describe("hidden terminal input", () => {
  const terminal = () => {
    const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false, setRawMode: vi.fn() });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    let displayed = "";
    output.on("data", chunk => { displayed += String(chunk); });
    return { input, output, displayed: () => displayed };
  };

  it("never echoes typed/pasted input and restores raw mode", async () => {
    const t = terminal();
    const result = readHiddenKey(t.input, t.output);
    t.input.write(key + "\r");
    expect(await result).toBe(key);
    expect(t.displayed()).toBe("Gateway private key (input hidden): \n");
    expect(t.displayed()).not.toContain(key);
    expect(t.input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(t.input.listenerCount("data")).toBe(0);
  });

  it("handles backspace without echo", async () => {
    const t = terminal();
    const result = readHiddenKey(t.input, t.output);
    t.input.write("ab\bC\n");
    expect(await result).toBe("aC");
    expect(t.displayed()).not.toContain("aC");
  });

  it("handles cancellation without printing an error or input", async () => {
    const t = terminal();
    const result = readHiddenKey(t.input, t.output);
    t.input.write(key + "\x03");
    expect(await result).toBeNull();
    expect(t.displayed()).not.toContain(key);
    expect(t.input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("refuses non-interactive input", async () => {
    const t = terminal();
    t.input.isTTY = false;
    expect(await readHiddenKey(t.input, t.output)).toBeNull();
    expect(t.displayed()).toBe("");
  });
});

describe("offline validator command", () => {
  it("refuses piped input and emits only the three safe result fields", () => {
    const result = spawnSync(process.execPath, ["scripts/validate-gateway-key.mjs"], { input: key + "\n", encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ valid: "invalid", publicAddress: null, matchesExpected: false });
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain(key);
  });

  it("does not accept or echo command arguments", () => {
    const result = spawnSync(process.execPath, ["scripts/validate-gateway-key.mjs", key], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ valid: "invalid", publicAddress: null, matchesExpected: false });
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain(key);
  });
});
