/** Demo A — a standalone script buys one Stub call and prints the result with its on-chain evidence. */
import { erc20Abi } from "viem";
import { StubClient } from "../packages/sdk/src/index";
import { filePending } from "../packages/sdk/src/node";
import { args, header, setup, tx, usdc } from "./_env";

const c = await setup();
header(c, "Demo A: standalone buyer");
const idea = args[0] ?? "A marketplace where small clinics rent idle MRI time to each other";
const wallet = c.wallet("buyer");
const bal = () => c.publicClient.readContract({ address: c.usdc, abi: erc20Abi, functionName: "balanceOf", args: [wallet.account.address] });

const stub = new StubClient({
  apiBase: c.apiBase,
  escrow: c.escrow,
  usdc: c.usdc,
  publicClient: c.publicClient,
  walletClient: wallet,
  pending: c.stack ? undefined : await filePending(".stub-pending.json"),
});

const before = await bal();
console.log(`buyer   ${wallet.account.address}`);
console.log(`balance ${usdc(before)}`);
console.log(`idea    "${idea}"\n`);

const out = await stub.buy({ serviceId: c.serviceId, input: idea, maxPrice: 100_000n });
const p = await stub.getPurchase(out.purchaseId);

console.log("brief:", JSON.stringify(out.result, null, 2).slice(0, 900), "\n");
console.log(`purchase  ${out.purchaseId}`);
console.log(`locked    ${tx(c, out.lockTx)}`);
console.log(`released  ${tx(c, out.fulfillTx)}`);
console.log(`status    ${["None", "Locked", "Released", "Refunded"][p.status]} (read back from the escrow)`);
console.log(`paid      ${usdc(before - (await bal()))}`);
await c.close();
