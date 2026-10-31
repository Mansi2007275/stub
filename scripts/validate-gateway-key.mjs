// Offline only. Run with no arguments, then enter the key at the hidden terminal prompt.
const expected = "0x499b7494b08163d867286b31fF25Fcd1038e03Ae";
let key;
let result = { valid: "invalid", publicAddress: null, matchesExpected: false };
try {
  if (process.argv.length !== 2) throw new Error();
  const { readHiddenKey } = await import("./lib/hidden-key-input.mjs");
  const { parseGatewayKey } = await import("../lib/server/gatewayKey.mjs");
  key = await readHiddenKey();
  const address = parseGatewayKey(key).address;
  result = { valid: "valid", publicAddress: address, matchesExpected: address.toLowerCase() === expected.toLowerCase() };
} catch { /* Never print the thrown error, its cause, or the input. */ }
finally { key = undefined; }
process.stdout.write(JSON.stringify(result) + "\n");
process.exitCode = result.valid === "valid" && result.matchesExpected ? 0 : 1;
