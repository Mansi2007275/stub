// Private acceptance instrumentation only. Never imported by the production app source.
export function acceptanceWallet(wallet, role, manifest, hooks = {}) {
  if (!manifest.phaseBApproved || manifest.phaseB?.maximumAdditionalGrossUSDC !== "0.0536") throw new Error("acceptance_phase_b_not_approved");
  const expected = role === "gateway" ? manifest.gateway : manifest.buyer;
  const normalized = value => typeof value === "string" ? value.toLowerCase() : value?.address?.toLowerCase();
  if (normalized(wallet.account) !== expected.toLowerCase() || wallet.chain?.id !== 5042) throw new Error("acceptance_wrong_wallet_or_chain");
  const reserved = new Set();
  return new Proxy(wallet, {
    get(target, property, receiver) {
      const method = Reflect.get(target, property, receiver);
      if (["sendTransaction", "sendRawTransaction", "signTransaction"].includes(property)) return () => { throw new Error("acceptance_uncapped_write_forbidden"); };
      if (property !== "writeContract") return typeof method === "function" ? method.bind(target) : method;
      return async request => {
        const name = request.functionName;
        const args = request.args ?? [];
        if (request.account && normalized(request.account) !== expected.toLowerCase()) throw new Error("acceptance_wrong_sender");
        if (request.chain && request.chain.id !== 5042) throw new Error("acceptance_wrong_chain");
        if (request.value && BigInt(request.value) !== 0n) throw new Error("acceptance_native_value_forbidden");
        let gas, operation, nonce;
        if (role === "buyer" && name === "approve") {
          if (!manifest.phaseB.approvalRequired || normalized(request.address) !== manifest.usdc.toLowerCase() || normalized(args[0]) !== manifest.escrow.toLowerCase() || BigInt(args[1]) !== 20000n) throw new Error("acceptance_wrong_approval");
          gas = 80000n;
          operation = "approve"; nonce = manifest.phaseB.buyerStartNonce;
        } else {
          if (normalized(request.address) !== manifest.escrow.toLowerCase()) throw new Error("acceptance_wrong_escrow");
          const purchaseId = name === "pay" ? args[1] : args[0];
          const entry = manifest.purchases.find(value => value.purchaseId.toLowerCase() === normalized(purchaseId));
          if (!entry) throw new Error("acceptance_unknown_purchase");
          if (entry.existing) throw new Error("acceptance_existing_purchase_no_new_payment_or_settlement");
          if (role === "buyer" && name === "pay") {
            if (BigInt(args[0]) !== 1n || normalized(args[2]) !== entry.inputHash.toLowerCase() || BigInt(args[3]) !== 10000n) throw new Error("acceptance_wrong_payment");
            gas = 300000n;
            operation = `pay:${entry.kind}`; nonce = manifest.phaseB.buyerStartNonce + (manifest.phaseB.approvalRequired ? 1 : 0) + (entry.kind === "paid_deck" ? 1 : 0);
          }
          else if (role === "gateway" && name === "fulfill" && entry.kind === "paid_deck") { gas = 180000n; operation = "fulfill"; nonce = manifest.phaseB.gatewayStartNonce + 1; }
          else if (role === "gateway" && name === "refundEarly" && entry.kind === "early_refund") { gas = 100000n; operation = "refundEarly"; nonce = manifest.phaseB.gatewayStartNonce; }
          else throw new Error("acceptance_unapproved_operation");
        }
        if (reserved.has(operation)) throw new Error("acceptance_operation_already_attempted");
        const capped = { ...request, gas, nonce, maxFeePerGas: 35000000000n, maxPriorityFeePerGas: 1000000000n };
        delete capped.gasPrice;
        await hooks.preflight?.(capped, operation);
        await hooks.reserve?.(capped, operation);
        reserved.add(operation); // Retained on error: unknown writes must be reconciled, never retried.
        const hash = await method.call(target, capped);
        await hooks.record?.(hash, capped, operation);
        return hash;
      };
    },
  });
}
