import { useEffect, useState } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { erc20Abi, isAddress, parseUnits, type Address } from "viem";
import { escrowAbi } from "../lib/escrowAbi";
import { ESCROW_ADDRESS, EXPLORER, IDENTITY_REGISTRY, USDC_DECIMALS, USDC_ADDRESS, chain, isDeployed } from "../lib/config";
import { usdc } from "../lib/format";
import { Hex } from "../components/Hex";

const identityAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

/** ERC-8004: does this agent hold an on-chain identity NFT in Arc's IdentityRegistry? */
function IdentityBadge({ agent }: { agent: Address }) {
  const { data } = useReadContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: "balanceOf", args: [agent], chainId: chain.id });
  if (data === undefined) return null;
  return data > 0n ? (
    <a className="id-badge yes" href={`${EXPLORER}/address/${IDENTITY_REGISTRY}`} target="_blank" rel="noreferrer" title="Registered in the ERC-8004 IdentityRegistry on Arc">
      ERC-8004 identity
    </a>
  ) : (
    <a className="id-badge" href="https://docs.arc.io/arc/tutorials/register-your-first-ai-agent.md" target="_blank" rel="noreferrer" title="This agent has no ERC-8004 identity yet">
      No on-chain identity
    </a>
  );
}

/** The daily budget as a punch card: one slot per maximum-size call. */
function PunchCard({ dailyCap, maxPerCall, spent }: { dailyCap: bigint; maxPerCall: bigint; spent: bigint }) {
  const slots = maxPerCall > 0n ? Math.min(20, Number(dailyCap / maxPerCall)) : 0;
  const punched = maxPerCall > 0n ? Math.min(slots, Number((spent + maxPerCall - 1n) / maxPerCall)) : 0;
  return (
    <div className="punches" role="img" aria-label={`${usdc(spent)} of ${usdc(dailyCap)} USDC spent today`}>
      {Array.from({ length: Math.max(slots, 1) }, (_, i) => (
        <span key={i} className={i < punched ? "punched" : ""} />
      ))}
    </div>
  );
}

function AgentRow({ owner, agent }: { owner: Address; agent: Address }) {
  const { data: b, refetch } = useReadContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "agentBudgets", args: [owner, agent], chainId: chain.id, query: { refetchInterval: 10_000 } });
  const { data: left } = useReadContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "remainingToday", args: [owner, agent], chainId: chain.id, query: { refetchInterval: 10_000 } });
  const revoke = useWriteContract();
  const revoked = useWaitForTransactionReceipt({ hash: revoke.data, chainId: chain.id });
  useEffect(() => {
    if (revoked.isSuccess) void refetch();
  }, [revoked.isSuccess, refetch]);
  if (!b) return null;
  const [maxPerCall, dailyCap, , , active] = b;
  const spent = active ? dailyCap - (left ?? dailyCap) : 0n;

  return (
    <div className={`ration agent-card ${active ? "" : "off"}`}>
      <div className="ration-head">
        <Hex value={agent} />
        <span className={`tag ${active ? "ok" : "no"}`}>{active ? "Active" : "Revoked"}</span>
      </div>
      <PunchCard dailyCap={dailyCap} maxPerCall={maxPerCall} spent={spent} />
      <div className="budget-nums">
        <span>
          {usdc(spent)} of {usdc(dailyCap)} USDC today
        </span>
        <span className="muted">up to {usdc(maxPerCall)} per call</span>
      </div>
      <div className="agent-foot">
        <IdentityBadge agent={agent} />
        {active && (
          <button
            className="btn small ghost"
            disabled={revoke.isPending}
            onClick={() => ESCROW_ADDRESS && revoke.writeContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "setAgentBudget", args: [agent, maxPerCall, dailyCap, false], chainId: chain.id })}
          >
            {revoke.isPending ? "Confirm in wallet" : "Revoke agent"}
          </button>
        )}
      </div>
      {revoke.error && <p className="form-error">{revoke.error.message.split("\n")[0]}</p>}
    </div>
  );
}

export function Agents() {
  const { address, isConnected } = useAccount();
  const disabled = !isDeployed || !isConnected;
  const [agent, setAgent] = useState("");
  const [per, setPer] = useState("0.05");
  const [cap, setCap] = useState("0.25");
  const [tracked, setTracked] = useState<Address[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("stub:agents") ?? "[]") as Address[];
    } catch {
      return [];
    }
  });
  const budget = useWriteContract();
  const approve = useWriteContract();
  const budgetDone = useWaitForTransactionReceipt({ hash: budget.data, chainId: chain.id });
  const approveDone = useWaitForTransactionReceipt({ hash: approve.data, chainId: chain.id });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && ESCROW_ADDRESS ? [address, ESCROW_ADDRESS] : undefined,
    chainId: chain.id,
    query: { enabled: !!address && isDeployed, refetchInterval: 10_000 },
  });

  useEffect(() => {
    if (approveDone.isSuccess) void refetchAllowance();
  }, [approveDone.isSuccess, refetchAllowance]);

  const perN = Number(per);
  const capN = Number(cap);
  const valid = isAddress(agent) && agent.toLowerCase() !== address?.toLowerCase() && perN > 0 && capN >= perN;
  const hint = !agent ? "" : !isAddress(agent) ? "That isn't an address." : agent.toLowerCase() === address?.toLowerCase() ? "Use a separate wallet for the agent." : capN < perN ? "The daily limit must be at least the per-call limit." : "";
  const err = budget.error ?? approve.error;

  const save = () => {
    if (!valid || !ESCROW_ADDRESS) return;
    budget.writeContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "setAgentBudget", args: [agent, parseUnits(per, USDC_DECIMALS), parseUnits(cap, USDC_DECIMALS), true], chainId: chain.id });
    const next = Array.from(new Set([agent, ...tracked]));
    setTracked(next);
    try {
      localStorage.setItem("stub:agents", JSON.stringify(next));
    } catch {
      /* storage blocked: list lives for this visit only */
    }
  };

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Agent budgets</h1>
        <p>Let an AI agent buy services with your USDC, inside limits the contract enforces. Refunds always come back to you, and you can revoke it any time.</p>
      </div>

      {disabled && (
        <div className="notice">
          <strong>{!isDeployed ? "Escrow not deployed yet." : "Connect your wallet"}</strong> {!isDeployed ? "Set VITE_ESCROW_ADDRESS after deploying." : "to set a budget."}
        </div>
      )}

      <div className="grid-2">
        <form className="panel" onSubmit={(e) => (e.preventDefault(), save())}>
          <h2>New budget</h2>
          <div className="field">
            <label htmlFor="agent">Agent address</label>
            <input id="agent" placeholder="0x…" disabled={disabled} spellCheck={false} value={agent} onChange={(e) => setAgent(e.target.value.trim())} />
            {hint && <span className="hint warn">{hint}</span>}
          </div>
          <div className="field">
            <label htmlFor="per">Most it can spend on one call</label>
            <input id="per" inputMode="decimal" disabled={disabled} value={per} onChange={(e) => setPer(e.target.value)} />
            <span className="hint">In USDC</span>
          </div>
          <div className="field">
            <label htmlFor="cap">Most it can spend per day</label>
            <input id="cap" inputMode="decimal" disabled={disabled} value={cap} onChange={(e) => setCap(e.target.value)} />
            <span className="hint">Resets at 00:00 UTC.</span>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button className="btn" disabled={disabled || !valid || budget.isPending}>
              {budget.isPending ? "Confirm in wallet" : budgetDone.isSuccess ? "Saved" : "Save budget"}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={disabled || !(capN > 0) || approve.isPending}
              onClick={() => ESCROW_ADDRESS && approve.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [ESCROW_ADDRESS, parseUnits(cap || "0", USDC_DECIMALS)], chainId: chain.id })}
            >
              {approve.isPending ? "Confirm in wallet" : approveDone.isSuccess ? "Allowance set" : `Allow ${cap || "0"} USDC`}
            </button>
          </div>
          <p className="hint" style={{ marginTop: 12 }}>
            The agent spends from your allowance{allowance !== undefined ? ` (currently ${usdc(allowance)} USDC)` : ""}. Approve at least the daily limit.
          </p>
          {err && <p className="form-error">{err.message.split("\n")[0]}</p>}
        </form>

        <div className="panel">
          <h2>Your agents</h2>
          {!address || tracked.length === 0 ? (
            <div className="empty">No budgets yet. Each agent you add gets a punch card showing today's spend.</div>
          ) : (
            <div className="agent-list">
              {tracked.map((a) => (
                <AgentRow key={a} owner={address} agent={a} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
