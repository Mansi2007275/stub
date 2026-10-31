import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { acceptanceWallet } from "../scripts/acceptance/transaction-caps.mjs";
// Historical cap rehearsal only: mocked wallets, never current spending authority.
const manifest = { ...JSON.parse(fs.readFileSync("docs/mainnet-acceptance-manifest.json", "utf8")), phaseBApproved: true };
const entry = (kind: string) => manifest.purchases.find((value: { kind: string }) => value.kind === kind);
const wallet = (role: "buyer" | "gateway") => ({ account: { address: manifest[role] }, chain: { id: 5042 }, writeContract: vi.fn(async (_request: unknown) => "simulated-only-no-broadcast") });

describe("private acceptance transaction cap enforcement", () => {
  it("refuses the now-closed repository execution manifest", () => {
    const closed = JSON.parse(fs.readFileSync("docs/mainnet-acceptance-manifest.json", "utf8"));
    expect(() => acceptanceWallet(wallet("buyer"), "buyer", closed)).toThrow("acceptance_phase_b_not_approved");
  });
  it.each([
    ["buyer", "approve", "paid_deck", 80000n],
    ["buyer", "pay", "paid_deck", 300000n],
    ["buyer", "pay", "early_refund", 300000n],
    ["gateway", "fulfill", "paid_deck", 180000n],
    ["gateway", "refundEarly", "early_refund", 100000n],
  ] as const)("pins gas and fee ceilings for %s %s (%s)", async (role, functionName, kind, gas) => {
    const raw = wallet(role);
    const client = acceptanceWallet(raw, role, manifest);
    const purchase = entry(kind);
    const args = functionName === "approve" ? [manifest.escrow, 20000n] : functionName === "pay" ? [1n, purchase.purchaseId, purchase.inputHash, 10000n] : functionName === "fulfill" ? [purchase.purchaseId, "0x" + "1".repeat(64)] : [purchase.purchaseId];
    await client.writeContract({ address: functionName === "approve" ? manifest.usdc : manifest.escrow, functionName, args, gas: 9999999n, maxFeePerGas: 999999999999n, gasPrice: 999999999999n });
    const request = raw.writeContract.mock.calls[0][0] as Record<string, unknown>;
    expect(request.gas).toBe(gas);
    expect(request.maxFeePerGas).toBe(35000000000n);
    expect(request.maxPriorityFeePerGas).toBe(1000000000n);
    expect(request.gasPrice).toBeUndefined();
  });

  it("forbids paying again for either existing purchase", async () => {
    const raw = wallet("buyer");
    const client = acceptanceWallet(raw,"buyer",manifest);
    for(const purchase of manifest.purchases.filter((value: { existing?: boolean })=>value.existing)) await expect(client.writeContract({address:manifest.escrow,functionName:"pay",args:[1n,purchase.purchaseId,purchase.inputHash,10000n]})).rejects.toThrow("acceptance_existing_purchase_no_new_payment_or_settlement");
    expect(raw.writeContract).not.toHaveBeenCalled();
  });

  it("refuses another wallet or chain before constructing the wrapper", () => {
    expect(() => acceptanceWallet({ ...wallet("buyer"), chain: { id: 1 } }, "buyer", manifest)).toThrow("acceptance_wrong_wallet_or_chain");
    expect(() => acceptanceWallet(wallet("gateway"), "buyer", manifest)).toThrow("acceptance_wrong_wallet_or_chain");
  });

  it("rejects excess approval, altered price/input and unapproved purchase IDs without sending", async () => {
    const raw = wallet("buyer");
    const client = acceptanceWallet(raw, "buyer", manifest);
    await expect(client.writeContract({ address: manifest.usdc, functionName: "approve", args: [manifest.escrow, 10001n] })).rejects.toThrow("acceptance_wrong_approval");
    await expect(client.writeContract({ address: manifest.escrow, functionName: "pay", args: [1n, entry("paid_deck").purchaseId, entry("paid_deck").inputHash, 10001n] })).rejects.toThrow("acceptance_wrong_payment");
    await expect(client.writeContract({ address: manifest.escrow, functionName: "pay", args: [1n, entry("paid_deck").purchaseId, "0x" + "0".repeat(64), 10000n] })).rejects.toThrow("acceptance_wrong_payment");
    await expect(client.writeContract({ address: manifest.escrow, functionName: "refund", args: ["0x" + "0".repeat(64)] })).rejects.toThrow("acceptance_unknown_purchase");
    expect(raw.writeContract).not.toHaveBeenCalled();
  });

  it("rejects settlement on the wrong test flow without sending", async () => {
    const raw = wallet("gateway");
    const client = acceptanceWallet(raw, "gateway", manifest);
    await expect(client.writeContract({ address: manifest.escrow, functionName: "refundEarly", args: [entry("timeout").purchaseId] })).rejects.toThrow("acceptance_existing_purchase_no_new_payment_or_settlement");
    await expect(client.writeContract({ address: manifest.escrow, functionName: "fulfill", args: [entry("timeout").purchaseId, "0x" + "1".repeat(64)] })).rejects.toThrow("acceptance_existing_purchase_no_new_payment_or_settlement");
    expect(raw.writeContract).not.toHaveBeenCalled();
  });

  it("refuses an unapproved second early refund for Deck failure", async () => {
    const raw = wallet("gateway");
    await expect(acceptanceWallet(raw,"gateway",manifest).writeContract({address:manifest.escrow,functionName:"refundEarly",args:[entry("paid_deck").purchaseId]})).rejects.toThrow("acceptance_unapproved_operation");
    expect(raw.writeContract).not.toHaveBeenCalled();
  });
  it("retains an operation reservation after an uncertain write", async () => {
    const raw=wallet("buyer");raw.writeContract.mockRejectedValue(new Error("unknown"));
    const client=acceptanceWallet(raw,"buyer",manifest);const request={address:manifest.usdc,functionName:"approve",args:[manifest.escrow,20000n]};
    await expect(client.writeContract(request)).rejects.toThrow("unknown");
    await expect(client.writeContract(request)).rejects.toThrow("acceptance_operation_already_attempted");
    expect(raw.writeContract).toHaveBeenCalledTimes(1);
  });
  it("blocks uncapped sends and rejects a second approval", async () => {
    const client=acceptanceWallet(wallet("buyer"),"buyer",manifest) as ReturnType<typeof wallet> & { sendTransaction:()=>unknown };
    expect(()=>client.sendTransaction()).toThrow("acceptance_uncapped_write_forbidden");
    const r={address:manifest.usdc,functionName:"approve",args:[manifest.escrow,20000n]};
    await client.writeContract(r);await expect(client.writeContract(r)).rejects.toThrow("acceptance_operation_already_attempted");
  });
});
