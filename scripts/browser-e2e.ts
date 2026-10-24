// oxlint-disable -- playwright is an optional runtime-only dependency; types are absent in the workspace
/**
 * Real-browser end-to-end check of the whole app against a LOCAL chain (anvil running with Arc
 * Testnet's chain id). A small injected wallet forwards signing to anvil's unlocked dev account,
 * so every page talks to the real contract and the real gateway code. LOCAL evidence only.
 *
 *   npm i --no-save playwright && npx playwright install chromium   (once)
 *   npx tsx scripts/browser-e2e.ts [screenshotDir]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { startLocalStack } from "../lib/dev/localStack";
import type { PitchBrief } from "../shared/protocol";

const OUT = process.argv[2] ?? "out/e2e";
const API_PORT = 8790;
const WEB_PORT = 4180;
const ARC_TESTNET = 5042002;

const brief = (idea: string): PitchBrief => ({
  title: "HallHours",
  oneLiner: "Idle community-hall evenings, bookable in two taps.",
  problem: `Halls sit empty most evenings. (${idea.slice(0, 40)})`,
  customer: "Hall managers at schools, temples and resident associations.",
  solution: "A booking page with deposits held in USDC escrow.",
  market: "Count halls in one city, multiply by idle evenings and price.",
  businessModel: "8% of each booking.",
  moat: "Local supply density and repeat organisers.",
  risks: ["Hall managers are slow to adopt software", "Damage disputes"],
  slides: ["Problem", "Solution", "Customer", "Model", "Why now"].map((t) => ({ title: t, bullets: [`${t} point one`, `${t} point two`] })),
});

const step = (s: string) => console.log(`• ${s}`);
const fail = (s: string): never => {
  throw new Error(`E2E FAILED: ${s}`);
};

await mkdir(OUT, { recursive: true });
const stack = await startLocalStack({ generate: async (i) => brief(i), chainId: ARC_TESTNET, apiPort: API_PORT, cors: true, anvilBin: process.env.ANVIL_BIN });
const buyer = stack.address("buyer");
step(`local chain ${stack.rpc} (chain id ${ARC_TESTNET}), escrow ${stack.escrow}`);

const env = {
  ...process.env,
  VITE_CHAIN: "testnet",
  VITE_ARC_TESTNET_RPC_URL: stack.rpc,
  VITE_ESCROW_ADDRESS: stack.escrow,
  VITE_USDC_ADDRESS: stack.usdc,
  VITE_API_BASE: `http://127.0.0.1:${API_PORT}/api`,
  VITE_ESCROW_DEPLOY_BLOCK: "0",
  VITE_SERVICE_ID: "1",
};
const run = (args: string[]) =>
  new Promise<void>((res, rej) => {
    const p = spawn(process.execPath, ["node_modules/vite/bin/vite.js", ...args.slice(1)], { env, stdio: "ignore" });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`${args.join(" ")} exited ${c}`))));
  });
await run(["vite", "build", "--outDir", `${OUT}/dist`, "--emptyOutDir"]);
const preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--outDir", `${OUT}/dist`, "--port", String(WEB_PORT), "--strictPort"], { env, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const BASE = `http://localhost:${WEB_PORT}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
// Injected EIP-1193 wallet: anvil holds the dev keys and signs eth_sendTransaction / personal_sign itself.
// Plain-string script so the bundler can't inject helpers into code that runs in the page.
await ctx.addInitScript(`(() => {
  const rpc = ${JSON.stringify(stack.rpc)}, account = ${JSON.stringify(buyer)}, chainId = ${ARC_TESTNET};
  let id = 0;
  const call = async (method, params) => {
    const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params || [] }) });
    const j = await r.json();
    if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; throw e; }
    return j.result;
  };
  const provider = {
    isMetaMask: true,
    request: async ({ method, params }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      if (method === "eth_chainId") return "0x" + chainId.toString(16);
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      if (method === "wallet_requestPermissions" || method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
      return call(method, params);
    },
    on() { return provider; },
    removeListener() { return provider; },
  };
  window.ethereum = provider;
})();`);

const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.text().startsWith("[try]")) console.log("CONSOLE", m.text().slice(0, 3000));
  if (m.type() === "error" && !/Failed to load resource|favicon|ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(m.text());
});
const shot = (p: Page, name: string, full = false) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });

try {
  // Home, empty escrow
  await page.goto(BASE);
  await page.getByText("No tickets yet").waitFor({ timeout: 20_000 });
  step("home renders live section with an empty escrow");
  await shot(page, "01-home-empty", true);

  // Connect
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: /0x90F7/i }).waitFor({ timeout: 10_000 });
  step("wallet connected");

  // Try: real paid call
  await page.goto(`${BASE}/try`);
  const idea = "A booking tool that lets community halls rent out idle evenings to local groups";
  await page.getByLabel("What are you building?").fill(idea);
  await shot(page, "02-try-draft");
  await page.getByRole("button", { name: /Pay 0.05 USDC and run/ }).click();
  await page.getByRole("heading", { name: "HallHours" }).waitFor({ timeout: 60_000 }).catch(async (e) => {
    await shot(page, "dbg-try");
    console.log("alert:", await page.locator("[role=alert]").allInnerTexts(), "steps:", await page.locator(".compact-steps").innerText(), "errors:", errors);
    throw e;
  });
  const released = await page.locator(".try-ticket .ticket[data-phase='released']").count();
  if (!released) fail("ticket did not reach Released");
  step("paid call: approve → lock → sign → generate → released; brief rendered");
  await shot(page, "03-try-released");
  const receiptHref = await page.getByRole("link", { name: "View receipt" }).getAttribute("href");
  if (!receiptHref) fail("no receipt link");
  const purchaseId = receiptHref!.split("/").pop() as `0x${string}`;
  const onchain = (await stack.client.readContract({ address: stack.escrow, abi: (await import("../shared/escrowAbi")).escrowAbi, functionName: "getPurchase", args: [purchaseId] })) as { status: number };
  if (onchain.status !== 2) fail(`purchase status on-chain is ${onchain.status}, expected 2`);
  step(`on-chain purchase ${purchaseId.slice(0, 12)}… is Fulfilled`);

  // Copy result JSON for later verification
  await page.getByRole("button", { name: "Copy result JSON" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());

  // Home again: ticket wall + hero show the real purchase
  await page.goto(BASE);
  await page.locator(".wall .ticket[data-phase='released']").first().waitFor({ timeout: 25_000 });
  const paid = await page.locator(".stats dd").first().innerText();
  if (paid.trim() !== "1") fail(`stats show ${paid} paid calls`);
  await page.getByText("Latest purchase on Arc").waitFor();
  step("home shows the real ticket on the wall, hero and stats (1 paid call)");
  await shot(page, "04-home-live", true);

  // Receipt: verify + mismatch
  await page.goto(`${BASE}/receipt/${purchaseId}`);
  await page.getByRole("heading", { name: "Verify the result" }).waitFor({ timeout: 15_000 });
  await page.getByLabel("Result JSON").fill(copied);
  await page.getByRole("button", { name: "Check against the chain" }).click();
  await page.getByText("Match. This is exactly the result").waitFor();
  step("receipt verifies the copied result against the on-chain hash");
  await shot(page, "05-receipt-verified", true);
  await page.getByLabel("Result JSON").fill(copied.replace("HallHours", "HallHourz"));
  await page.getByRole("button", { name: "Check against the chain" }).click();
  await page.getByText("No match.").waitFor();
  step("a tampered result is rejected");

  // Merchant: list a second service
  await page.goto(`${BASE}/merchant`);
  await page.getByLabel("Gateway address").fill(stack.address("agent"));
  await page.getByRole("button", { name: "List service" }).click();
  await page.getByRole("button", { name: "Listed" }).waitFor({ timeout: 20_000 });
  await page.getByText("Service #2").waitFor({ timeout: 20_000 });
  step("merchant lists service #2 and sees it in 'Your services'");
  await shot(page, "06-merchant");

  // Agents: budget, allowance, revoke
  await page.goto(`${BASE}/agents`);
  await page.getByLabel("Agent address").fill(stack.address("agent"));
  await page.getByRole("button", { name: "Save budget" }).click();
  await page.getByRole("button", { name: "Saved" }).waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: /Allow 0.25 USDC/ }).click();
  await page.getByRole("button", { name: "Allowance set" }).waitFor({ timeout: 20_000 });
  await page.locator(".agent-card .punches span").first().waitFor({ timeout: 20_000 });
  const slots = await page.locator(".agent-card .punches span").count();
  if (slots !== 5) fail(`punch card shows ${slots} slots, expected 5`);
  await shot(page, "07-agents");
  await page.getByRole("button", { name: "Revoke agent" }).click();
  await page.locator(".agent-card .tag", { hasText: "Revoked" }).waitFor({ timeout: 20_000 });
  step("agent budget saved (5-slot punch card), allowance set, agent revoked");

  // Deck Builder: with Stub, then flag off
  await page.goto(`${BASE}/deck`);
  await page.getByLabel("What are you pitching?").fill("Rent idle camera gear to film students in the same neighbourhood");
  await page.getByRole("button", { name: /Pay 0.05 USDC and build deck/ }).click();
  await page.getByRole("heading", { name: "Bought from Stub" }).waitFor({ timeout: 60_000 });
  const slideCount = await page.locator(".slide").count();
  if (slideCount < 8) fail(`deck has ${slideCount} slides`);
  const fromStub = await page.locator(".slide-src").count();
  if (!fromStub) fail("deck slides are not marked as built from the purchased brief");
  step(`Deck Builder bought a brief and built ${slideCount} slides from it`);
  await shot(page, "08-deck", true);
  await page.getByLabel("Buy the analysis from Stub").uncheck();
  await page.getByRole("button", { name: "Build deck without Stub" }).click();
  await page.locator(".slide").first().waitFor();
  if (await page.getByRole("heading", { name: "Bought from Stub" }).count()) fail("flag-off deck still shows a purchase");
  step("Deck Builder with the flag off builds a deck with no purchase");

  // Mobile
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(BASE);
  await m.locator(".wall .ticket").first().waitFor({ timeout: 25_000 });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) fail("horizontal overflow on mobile home");
  await shot(m, "09-mobile-home", true);
  await m.goto(`${BASE}/deck`);
  await shot(m, "10-mobile-deck");
  step("mobile layout has no horizontal overflow");

  const real = errors.filter((e) => !/WalletConnect|Lit is in dev mode/.test(e));
  if (real.length) fail(`console errors:\n  ${real.join("\n  ")}`);
  console.log(`\nALL BROWSER CHECKS PASSED (local chain). Screenshots in ${OUT}/`);
} finally {
  await browser.close();
  preview.kill();
  await stack.stop();
}
