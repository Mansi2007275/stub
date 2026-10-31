import { afterEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import health from "../api/health";

afterEach(() => vi.unstubAllEnvs());

async function inspect() {
  let body: Record<string, unknown> = {};
  const response = {
    setHeader() {},
    status() { return response; },
    json(value: Record<string, unknown>) { body = value; return response; },
  };
  await health({ method: "GET", query: {} } as VercelRequest, response as unknown as VercelResponse);
  return body;
}

describe("health gateway identity", () => {
  it("reports only the derived public address, never the key", async () => {
    // Anvil's public test-only key, never a user credential.
    const key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    vi.stubEnv("FULFILLER_PRIVATE_KEY", key);
    const out = await inspect();
    expect(out.fulfillerAddress).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(out.fulfillerKeyValid).toBe(true);
    expect(out.fulfillerKeyError).toBeNull();
    expect(JSON.stringify(out)).not.toContain(key);
  });

  it("reports no derived address for an invalid key without exposing its value", async () => {
    vi.stubEnv("FULFILLER_PRIVATE_KEY", "invalid-secret-value");
    const out = await inspect();
    expect(out.fulfillerAddress).toBeNull();
    expect(out.fulfillerKeyError).toBe("invalid_format");
    expect(JSON.stringify(out)).not.toContain("invalid-secret-value");
  });

  it("reports no derived address when the key is absent", async () => {
    vi.stubEnv("FULFILLER_PRIVATE_KEY", "");
    expect((await inspect()).fulfillerAddress).toBeNull();
  });

  it("rejects invalid scalar values before runtime signing, with no value in diagnostics", async () => {
    const key = "0x" + "0".repeat(64);
    vi.stubEnv("FULFILLER_PRIVATE_KEY", key);
    const out = await inspect();
    expect(out.fulfillerKeyValid).toBe(false);
    expect(out.fulfillerKeyError).toBe("invalid_scalar");
    expect(JSON.stringify(out)).not.toContain(key);
  });

  it("rejects a non-0x prefix instead of silently accepting viem's slice(2)", async () => {
    vi.stubEnv("FULFILLER_PRIVATE_KEY", "zz" + "0".repeat(63) + "1");
    const out = await inspect();
    expect(out.fulfillerAddress).toBeNull();
    expect(out.fulfillerKeyError).toBe("invalid_format");
  });
});
