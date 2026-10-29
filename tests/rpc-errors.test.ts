/**
 * The buyer-facing "Network is busy" message must appear for throttling and NOTHING else.
 *
 * The bug this pins: isRpcBusy() used to match the text /rate limit|exceeds defined limit|429/
 * against the error message. A viem error message embeds the whole request dump (addresses +
 * calldata), so any unrelated failure whose hex happened to contain "429" was shown to the buyer
 * as "Network is busy, retry in a few seconds" - hiding the real error.
 */
import { describe, expect, it } from "vitest";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  HttpRequestError,
  InternalRpcError,
  LimitExceededRpcError,
  RpcRequestError,
  UserRejectedRequestError,
  erc20Abi,
} from "viem";
import { describeRpcError, isRpcBusy } from "../src/lib/rpcError";

const url = "https://rpc.testnet.arc.io";

/** Exactly what viem builds from Arc's `{"error":{"code":-32005,"message":"rate limit exceeded"}}`. */
const throttled = () =>
  new LimitExceededRpcError(
    new RpcRequestError({ body: { method: "eth_call" }, error: { code: -32005, message: "rate limit exceeded" }, url }),
  );

/** A 429 with no JSON-RPC body (a gateway HTML page), which viem reports as HttpRequestError. */
const http429 = () => new HttpRequestError({ body: { method: "eth_call" }, details: "Too Many Requests", status: 429, url });

/** A revert wrapped the way a contract read fails - with calldata that happens to contain "429". */
const revertWithHexContaining429 = () =>
  new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({ abi: erc20Abi, functionName: "allowance", message: "execution reverted" }),
    {
      abi: erc20Abi,
      functionName: "allowance",
      args: ["0x4290000000000000000000000000000000000429", "0x9777da550470de0508d02d34b2c12b95e49c10a5"],
      contractAddress: "0x3600000000000000000000000000000000000000",
    },
  );

describe("isRpcBusy", () => {
  it("is true for JSON-RPC -32005", () => {
    expect(isRpcBusy(throttled())).toBe(true);
  });

  it("is true for HTTP 429", () => {
    expect(isRpcBusy(http429())).toBe(true);
  });

  it("is true through a cause chain (what a contract read actually throws)", () => {
    const wrapped = new ContractFunctionExecutionError(throttled(), {
      abi: erc20Abi,
      functionName: "allowance",
      args: ["0x71aEE14669EaF0a2f55b783Eed64Ad12B66177ee", "0x9777da550470de0508d02d34b2c12b95e49c10a5"],
      contractAddress: "0x3600000000000000000000000000000000000000",
    });
    expect(isRpcBusy(wrapped)).toBe(true);
  });

  it("is true for a wallet error that nests the provider code in `data`", () => {
    // MetaMask: { code: -32603, message: "Internal JSON-RPC error", data: { code: -32005, ... } }
    expect(isRpcBusy({ code: -32603, message: "Internal JSON-RPC error", data: { code: -32005 } })).toBe(true);
  });

  // --- the regression ------------------------------------------------------

  it("is FALSE for an unrelated failure whose message embeds the hex 429", () => {
    const e = revertWithHexContaining429();
    expect(e.message).toContain("429"); // the string the old text match tripped on
    expect(isRpcBusy(e)).toBe(false);
  });

  it("is FALSE when the user rejects in their wallet", () => {
    expect(isRpcBusy(new UserRejectedRequestError(new Error("User rejected the request.")))).toBe(false);
    expect(isRpcBusy({ code: 4001, message: "User rejected the request." })).toBe(false);
  });

  it("is FALSE for a generic internal RPC error", () => {
    const e = new InternalRpcError(new RpcRequestError({ body: { method: "eth_sendTransaction" }, error: { code: -32603, message: "Internal error" }, url }));
    expect(isRpcBusy(e)).toBe(false);
  });

  it("is FALSE for a plain Error, a string and nullish input", () => {
    expect(isRpcBusy(new Error("rate limit exceeded"))).toBe(false); // text alone is never enough
    expect(isRpcBusy("rate limit exceeded")).toBe(false);
    expect(isRpcBusy(undefined)).toBe(false);
  });
});

describe("describeRpcError", () => {
  it("reports the method, JSON-RPC code and endpoint of a throttled call", () => {
    const f = describeRpcError(throttled());
    expect(f).toMatchObject({ method: "eth_call", code: -32005, url, busy: true, name: "LimitExceededRpcError" });
  });

  it("reports the HTTP status of a 429 with no JSON-RPC body", () => {
    const f = describeRpcError(http429());
    expect(f).toMatchObject({ status: 429, url, busy: true, name: "HttpRequestError" });
  });

  it("keeps a revert's own short message, on one line", () => {
    const f = describeRpcError(revertWithHexContaining429());
    expect(f.busy).toBe(false);
    expect(f.message).not.toContain("\n");
    expect(f.message.toLowerCase()).toContain("revert");
  });
});
