/**
 * Demo B — Deck Builder (separate consumer app) buys a Stub brief with its agent budget and builds a deck.
 *   npm run demo:deck -- --local "idea"            local chain, no keys
 *   USE_STUB=false npm run demo:deck -- --local "idea"   feature flag off: no purchase, still a deck
 */
import { mkdir, writeFile } from "node:fs/promises";
import { erc20Abi, parseUnits } from "viem";
import { escrowAbi } from "../../shared/escrowAbi";
import { StubClient } from "../../packages/sdk/src/index";
import { filePending } from "../../packages/sdk/src/node";
import { args, header, isLocal, setup, tx } from "../../examples/_env";
import { createDeckBuilder, geminiDeck, renderDeckHtml, templateDeck } from "./src/deck";
import { fileJobs } from "./src/fileJobs";

const c = await setup();
header(c, "Demo B: Deck Builder buys from Stub");
const useStub = process.env.USE_STUB !== "false";
const idea = args[0] ?? "A marketplace where small clinics rent idle MRI time to each other";
const jobId = process.env.JOB_ID ?? `job-${Date.now()}`;
await mkdir("out", { recursive: true });

let stub: StubClient | undefined;
if (useStub) {
  const agent = c.wallet("agent");
  const owner = isLocal ? c.wallet("deckApp") : undefined;
  const ownerAddr = (isLocal ? owner!.account.address : process.env.DECK_OWNER_ADDRESS) as `0x${string}` | undefined;
  if (!ownerAddr) throw new Error("Set DECK_OWNER_ADDRESS (the wallet that set this agent's budget on /agents)");
  if (isLocal && owner) {
    // Local only: the Deck Builder's owner wallet grants its agent a small budget.
    const w = async (h: Promise<`0x${string}`>) => c.publicClient.waitForTransactionReceipt({ hash: await h });
    await w(owner.writeContract({ address: c.escrow, abi: escrowAbi, functionName: "setAgentBudget", args: [agent.account.address, parseUnits("0.10", 6), parseUnits("1", 6), true] }));
    await w(owner.writeContract({ address: c.usdc, abi: erc20Abi, functionName: "approve", args: [c.escrow, parseUnits("1", 6)] }));
  }
  stub = new StubClient({
    apiBase: c.apiBase,
    escrow: c.escrow,
    usdc: c.usdc,
    publicClient: c.publicClient,
    walletClient: agent,
    agentOf: ownerAddr,
    pending: isLocal ? undefined : await filePending("out/.deck-pending.json"),
  });
}

const generate = process.env.GEMINI_API_KEY ? geminiDeck(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite") : templateDeck;
const builder = createDeckBuilder({ jobs: await fileJobs("out/deck-jobs.json"), generate, useStub, stub, serviceId: c.serviceId });

const job = await builder.run(jobId, idea);
console.log(`job      ${job.id}  status=${job.status}${job.error ? `  error=${job.error}` : ""}`);
console.log(`stub     ${job.useStub ? "on" : "off (feature flag)"}`);
if (job.stub) {
  console.log(`purchase ${job.stub.purchaseId}`);
  console.log(`locked   ${tx(c, job.stub.lockTx)}`);
  console.log(`released ${tx(c, job.stub.fulfillTx)}`);
}
if (job.deck) {
  console.log(`deck     "${job.deck.title}" — ${job.deck.slides.length} slides: ${job.deck.slides.map((s) => s.title).join(" | ")}`);
  await writeFile(`out/deck-${job.id}.json`, JSON.stringify(job, null, 2));
  await writeFile(`out/deck-${job.id}.html`, renderDeckHtml(job, c.explorer));
  console.log(`saved    out/deck-${job.id}.html`);
}
await c.close();
