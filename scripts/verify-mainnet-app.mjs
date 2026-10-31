// HTTP/RPC reads only. Never fetches Vercel secrets or sends blockchain transactions.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const origin = process.argv[2];
const authenticated = process.argv.includes("--authenticated");
if (!origin || new URL(origin).protocol !== "https:" || !new URL(origin).hostname.endsWith(".vercel.app")) throw new Error("Supply the deployed HTTPS vercel.app origin");
const escrow = "0xf294ecc15b52a5c7ab7466885b8a033cb92c85c1";
const gateway = "0x499b7494b08163d867286b31ff25fcd1038e03ae";
const get = async path => {
  if (authenticated) {
    const cli = `${process.env.APPDATA}/npm/node_modules/vercel/dist/vc.js`;
    const result = spawnSync(process.execPath, [cli, "curl", path, "--deployment", origin, "--scope", "mansi2007275s-projects", "--", "--silent", "--show-error", "--max-time", "65", "--write-out", "\nSTUB_HTTP_METADATA:%{http_code}|%{content_type}"], { cwd: ".vercel/mainnet", encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`Authenticated request failed for ${path} (exit ${result.status}); no response payload logged`);
    const marker = result.stdout.lastIndexOf("\nSTUB_HTTP_METADATA:");
    if (marker < 0) throw new Error("Missing authenticated HTTP metadata; no response payload logged");
    const [status, contentType] = result.stdout.slice(marker + "\nSTUB_HTTP_METADATA:".length).trim().split("|");
    return { response: { status: Number(status), headers: new Headers({ "content-type": contentType }) }, text: result.stdout.slice(0, marker) };
  }
  const response = await fetch(new URL(path, origin), { redirect: "manual", signal: AbortSignal.timeout(65_000), cache: "no-store" });
  return { response, text: await response.text() };
};
const json = async path => {
  const { response, text } = await get(path);
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: response.status, body };
};
const health = await json("/api/health");
if (!health.body) throw new Error(`Health returned HTTP ${health.status} without JSON; deployment protection or routing must be checked before application verification`);
const summary = { checkedAt: new Date().toISOString(), origin, authenticatedChecks: authenticated, health: { status: health.status, ok: health.body?.ok, network: health.body?.network,
  configured: health.body?.configured, fulfillerAddress: health.body?.fulfillerAddress,
  fulfillerKeyValid: health.body?.fulfillerKeyValid, fulfillerKeyError: health.body?.fulfillerKeyError,
  gatewayMatches: health.body?.fulfillerAddress?.toLowerCase() === gateway } };
const services = await json("/api/services");
const service = services.body?.services?.find(value => value.id === "1");
summary.service = { status: services.status, value: service, matches: !!service && service.merchant.toLowerCase() === "0x075ff540a0f8e9340a4813ef96c609dc203a3041" && service.fulfiller.toLowerCase() === gateway && service.price === "10000" && service.timeout === 600 && service.active === true };
// Success exercises Redis GET, SET NX, document SET and lock DEL; a second GET checks cached reads.
const feed = await json("/api/feed");
const feedAgain = await json("/api/feed");
summary.redis = { feedStatus: feed.status, repeatedFeedStatus: feedAgain.status, chainId: feed.body?.chainId,
  connectivityVerified: feed.status === 200 && feedAgain.status === 200 && feed.body?.chainId === 5042,
  error: feed.body?.error ?? null };
// Filter the response: never print key prefixes, lengths, raw provider messages or secret values.
const gemini = await json("/api/health?check=gemini");
summary.gemini = { status: gemini.status, results: gemini.body?.gemini?.results?.map(value => ({ model: value.model, ok: value.ok, httpStatus: value.httpStatus, googleStatus: value.googleStatus, ms: value.ms })), error: gemini.body?.error ?? gemini.body?.gemini?.error ?? null };
const routes = ["/", "/try", "/agents", "/merchant", "/deck", "/receipt/0x" + "00".repeat(32)];
summary.routes = [];
let html = "";
for (const path of routes) {
  const result = await get(path);
  if (path === "/") html = result.text;
  summary.routes.push({ path, status: result.response.status, html: result.response.headers.get("content-type")?.includes("text/html") });
}
const assetPaths = [...new Set([...html.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g)].map(match => match[1]))];
let javascript = "";
summary.assets = [];
for (const path of assetPaths) {
  const result = await get(path);
  if (path.endsWith(".js")) javascript += result.text.toLowerCase();
  summary.assets.push({ path, status: result.response.status, contentType: result.response.headers.get("content-type") });
}
summary.browserConfig = { containsMainnetEscrow: javascript.includes(escrow), containsMainnetRpc: javascript.includes("rpc.mainnet.arc.io"),
  containsMainnetExplorer: javascript.includes("https://explorer.arc.io"), containsOldTestnetEscrow: javascript.includes("0x9777da550470de0508d02d34b2c12b95e49c10a5") };
const blockedApi = await get("/api/does-not-exist");
summary.unknownApi = { status: blockedApi.response.status, returnsSpa: blockedApi.text.includes('<div id="root">') };
summary.paidAcceptance = "not performed by this read-only check; historical protected-build evidence is recorded separately";
fs.writeFileSync("docs/mainnet-app-verification.json", JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
