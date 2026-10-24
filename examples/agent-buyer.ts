/**
 * Agent budget demo — an owner gives an agent 0.05 USDC per call and 0.10 USDC per day.
 * The agent buys twice; the third purchase is rejected by the contract. Refunds would go to the owner.
 */
import { erc20Abi, parseUnits } from "viem";
import { escrowAbi } from "../shared/escrowAbi";
import { StubClient, StubError } from "../packages/sdk/src/index";
import { header, setup, tx, usdc } from "./_env";

const c = await setup();
header(c, "Agent budget");
const owner = c.wallet("owner");
const agent = c.wallet("agent");
const wait = async (h: Promise<`0x${string}`>) => c.publicClient.waitForTransactionReceipt({ hash: await h });

const per = parseUnits("0.05", 6);
const day = parseUnits("0.10", 6);
await wait(owner.writeContract({ address: c.escrow, abi: escrowAbi, functionName: "setAgentBudget", args: [agent.account.address, per, day, true] }));
await wait(owner.writeContract({ address: c.usdc, abi: erc20Abi, functionName: "approve", args: [c.escrow, day] }));
console.log(`owner ${owner.account.address} → agent ${agent.account.address}: ${usdc(per)}/call, ${usdc(day)}/day\n`);

const stub = new StubClient({ apiBase: c.apiBase, escrow: c.escrow, usdc: c.usdc, publicClient: c.publicClient, walletClient: agent, agentOf: owner.account.address });
const ideas = ["Agent buy 1: AI bookkeeping for street vendors", "Agent buy 2: rental marketplace for camera gear", "Agent buy 3: should hit the daily cap"].map(
  (i) => `${i} (${Date.now()})`,
);
for (const idea of ideas) {
  try {
    const out = await stub.buy({ serviceId: c.serviceId, input: idea });
    const left = await c.publicClient.readContract({ address: c.escrow, abi: escrowAbi, functionName: "remainingToday", args: [owner.account.address, agent.account.address] });
    console.log(`✓ ${idea.slice(0, 40)}…  released ${tx(c, out.fulfillTx)}  left today ${usdc(left)}`);
  } catch (e) {
    console.log(`✗ ${idea.slice(0, 40)}…  rejected: ${(e as StubError).code} ${String((e as StubError).detail ?? "").slice(0, 80)}`);
  }
}
await c.close();
