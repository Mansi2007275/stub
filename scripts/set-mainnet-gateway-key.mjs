// Run in the operator's terminal AFTER the offline validator reports a match.
// Sends the same in-memory validated bytes to Vercel over stdin. Never redeploys.
const expected = "0x499b7494b08163d867286b31fF25Fcd1038e03Ae";
const project = "prj_wInckyAHCYEG3VyRxxj546QBYX3T";
const scope = "mansi2007275s-projects";
let key;
let targetVerified = false;
try {
  if (process.argv.length !== 2) throw new Error();
  const { spawnSync } = await import("node:child_process");
  const { join } = await import("node:path");
  const { readHiddenKey } = await import("./lib/hidden-key-input.mjs");
  const { parseGatewayKey } = await import("../lib/server/gatewayKey.mjs");
  if (!process.env.APPDATA) throw new Error();
  const cli = join(process.env.APPDATA, "npm/node_modules/vercel/dist/vc.js");
  // This command displays project identity/build metadata only, never saved environment values.
  const inspected = spawnSync(process.execPath, [cli, "project", "inspect", "stub-mainnet", "--scope", scope, "--non-interactive"], { encoding: "utf8", windowsHide: true });
  const metadata = (inspected.stdout + inspected.stderr).replace(/\x1b\[[0-9;]*m/g, "");
  if (inspected.status !== 0 || !metadata.includes(project) || !/\bName\s+stub-mainnet\b/.test(metadata)) throw new Error();
  targetVerified = true;
  process.stderr.write("Verified target: stub-mainnet / Production (mansi2007275s-projects).\n");
  key = await readHiddenKey();
  let result = { valid: "invalid", publicAddress: null, matchesExpected: false };
  try {
    const address = parseGatewayKey(key).address;
    result = { valid: "valid", publicAddress: address, matchesExpected: address.toLowerCase() === expected.toLowerCase() };
  } catch { /* no input or exception output */ }
  process.stdout.write(JSON.stringify(result) + "\n");
  if (!result.matchesExpected) { process.exitCode = 1; }
  else {
    const uploaded = spawnSync(process.execPath, [cli, "env", "add", "FULFILLER_PRIVATE_KEY", "production", "--project", project, "--scope", scope, "--sensitive", "--force", "--yes"], { input: key, encoding: "utf8", windowsHide: true });
    // Do not print CLI stdout/stderr: future CLI errors might echo sensitive input.
    if (uploaded.status !== 0) throw new Error();
    process.stdout.write("Updated FULFILLER_PRIVATE_KEY in stub-mainnet Production. No deployment was started.\n");
  }
} catch {
  process.stderr.write(targetVerified ? "Update did not complete; no diagnostic payload was displayed.\n" : "Target verification failed; no key was requested.\n");
  process.exitCode = 1;
} finally { key = undefined; }
