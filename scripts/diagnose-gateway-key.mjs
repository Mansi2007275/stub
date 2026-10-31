// Offline only. Prints metadata, never the key or its public address. No secret args/env/files.
let result = { inputLength: null, prefixValid: false, hexValid: false, failureCategory: "diagnostic_unavailable" };
let entered;
try {
  if (process.argv.length !== 2) throw new Error();
  const { readHiddenKeyResult } = await import("./lib/hidden-key-input.mjs");
  const { diagnoseGatewayInput } = await import("./lib/gateway-input-diagnostics.mjs");
  entered = await readHiddenKeyResult();
  result = diagnoseGatewayInput(entered.value, entered.failureCategory);
} catch { /* no raw exception or input output */ }
finally { if (entered) entered.value = null; entered = undefined; }
process.stdout.write(JSON.stringify(result) + "\n");
process.exitCode = result.failureCategory === "none" ? 0 : 1;
