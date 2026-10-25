import { useState } from "react";
import { Link } from "react-router-dom";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import type { Hex } from "viem";
import { chain, isDeployed } from "../lib/config";
import { ERRORS, loadPending, payAndCall, type Step } from "../lib/payCall";
import { Hex as HexText } from "../components/Hex";
import { EscrowTicket, type TicketPhase } from "../components/EscrowTicket";
import { canonicalJson, hashInput, type PitchBrief } from "../../shared/protocol";

const STEPS: { key: Step; title: string; hint: string }[] = [
  { key: "approve", title: "Approve USDC", hint: "Allowance for exactly one call" },
  { key: "lock", title: "Lock payment", hint: "0.05 USDC held against your purchase ID" },
  { key: "sign", title: "Sign the request", hint: "Proves you're the payer. No gas." },
  { key: "generate", title: "Generate", hint: "The gateway writes your pitch brief" },
  { key: "done", title: "Released", hint: "Result hash posted, seller paid" },
];
const ORDER: Step[] = ["quote", "approve", "lock", "sign", "generate", "done"];

export function Try() {
  const { address, isConnected, chainId } = useAccount();
  const { data: wallet } = useWalletClient({ chainId: chain.id });
  const client = usePublicClient({ chainId: chain.id });
  const pending = loadPending();

  const [idea, setIdea] = useState(pending?.input ?? "");
  const [step, setStep] = useState<Step | null>(null);
  const [txs, setTxs] = useState<Partial<Record<Step, Hex>>>({});
  const [purchaseId, setPurchaseId] = useState<Hex | undefined>(pending?.purchaseId);
  const [brief, setBrief] = useState<PitchBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultHash, setResultHash] = useState<Hex | undefined>();
  const [refunded, setRefunded] = useState(false);

  const onRightChain = chainId === chain.id;
  const resumable = pending && pending.input === idea ? pending.purchaseId : undefined;
  const ready = isDeployed && isConnected && onRightChain && !!wallet && !!client && idea.trim().length >= 20 && !busy;

  async function run() {
    if (!wallet || !client || !address) return;
    setBusy(true);
    setError(null);
    setBrief(null);
    setResultHash(undefined);
    setRefunded(false);
    try {
      const out = await payAndCall({
        input: idea,
        account: address,
        wallet,
        client,
        resume: resumable,
        onProgress: (p) => {
          setStep(p.step);
          if (p.purchaseId) setPurchaseId(p.purchaseId);
          if (p.tx) setTxs((t) => ({ ...t, [p.step]: p.tx }));
        },
      });
      if (out.ok) {
        setBrief(out.result);
        setResultHash(out.resultHash);
      } else {
        if (out.refunded) setRefunded(true);
        const why = typeof out.detail === "string" ? ` (${out.detail})` : "";
        setError(`${ERRORS[out.error] ?? `Call failed: ${out.error}`}${why}`);
      }
    } catch (e) {
      const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message;
      setError(/rejected|denied/i.test(msg) ? "You cancelled in your wallet. Nothing was charged unless the lock step finished." : msg);
    } finally {
      setBusy(false);
    }
  }

  const reached = (s: Step) => step !== null && ORDER.indexOf(step) >= ORDER.indexOf(s);

  // The ticket follows the real settlement: printed while paying, stamped by the chain.
  const phase: TicketPhase = refunded
    ? "refunded"
    : step === "done"
      ? "released"
      : step === "generate" || step === "sign" || (step === "lock" && txs.lock)
        ? "locked"
        : step === "quote" || step === "approve" || step === "lock"
          ? "printing"
          : "draft";

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Try a paid call</h1>
        <p>Describe a startup idea. You pay 0.05 USDC into escrow and get a structured pitch brief back. No result, no charge.</p>
      </div>

      {!isDeployed && (
        <div className="notice">
          <strong>Payments are off.</strong> Deploy the escrow and set VITE_ESCROW_ADDRESS to turn this page on.
        </div>
      )}
      {isConnected && !onRightChain && (
        <div className="notice">
          <strong>Wrong network.</strong> Switch your wallet to {chain.name} with the button at the top.
        </div>
      )}
      {resumable && !busy && !brief && (
        <div className="notice">
          <strong>You already paid for this idea.</strong> Running it again resumes that purchase. You won't be charged twice.
        </div>
      )}

      <div className="grid-try">
        <div className="panel">
          <h2>Your idea</h2>
          <div className="field">
            <label htmlFor="idea">What are you building?</label>
            <textarea
              id="idea"
              maxLength={4000}
              value={idea}
              disabled={busy}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="A marketplace where small clinics rent idle MRI time to each other"
            />
            <span className="hint">{idea.length}/4000. At least 20 characters.</span>
          </div>
          <button className="btn" disabled={!ready} style={{ width: "100%" }} onClick={() => void run()}>
            {busy ? "Working" : resumable ? "Resume my paid call" : "Pay 0.05 USDC and run"}
          </button>
          {error && (
            <p role="alert" style={{ color: "var(--refund)", fontSize: "var(--t-sm)", marginTop: 14 }}>
              {error}
            </p>
          )}
        </div>

        <div className="panel ticket-panel">
          <h2>Your ticket</h2>
          <div className={`try-ticket ${phase === "draft" ? "is-draft" : ""}`}>
            <EscrowTicket
              phase={phase}
              data={{
                purchaseId,
                payer: address,
                inputHash: phase === "draft" || phase === "printing" ? undefined : hashInput(idea),
                resultHash,
              }}
            />
          </div>
          <ol className="steps compact-steps">
            {STEPS.map((s) => (
              <li key={s.key} style={{ opacity: reached(s.key) || step === null ? 1 : 0.5 }}>
                <strong style={{ color: step === s.key && busy ? "var(--usdc)" : reached(s.key) ? "var(--released)" : undefined }}>
                  {s.title}
                </strong>
                <span>{txs[s.key] ? <HexText value={txs[s.key]} kind="tx" /> : s.hint}</span>
              </li>
            ))}
          </ol>
          {purchaseId && (
            <p style={{ fontSize: "var(--t-sm)", margin: 0 }}>
              <Link className="link" to={`/receipt/${purchaseId}`}>
                View receipt
              </Link>
            </p>
          )}
        </div>

        <div className="panel">
          <h2>Pitch brief</h2>
          {!brief ? (
            <div className="empty">{busy ? "Waiting for delivery" : "Your brief and receipt appear here after the call settles."}</div>
          ) : (
            <article className="brief">
              <h3 style={{ fontFamily: "var(--f-display)", fontSize: "var(--t-xl)", margin: "0 0 4px", letterSpacing: "-0.02em" }}>{brief.title}</h3>
              <p className="muted" style={{ marginTop: 0 }}>{brief.oneLiner}</p>
              <dl className="kv" style={{ fontFamily: "var(--f-body)" }}>
                {(
                  [
                    ["Problem", brief.problem],
                    ["Customer", brief.customer],
                    ["Solution", brief.solution],
                    ["Market", brief.market],
                    ["Model", brief.businessModel],
                    ["Moat", brief.moat],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt>{k}</dt>
                    <dd style={{ fontFamily: "var(--f-body)" }}>{v}</dd>
                  </div>
                ))}
              </dl>
              <h4 style={{ margin: "18px 0 6px" }}>Risks</h4>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "var(--t-sm)" }}>
                {brief.risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <h4 style={{ margin: "18px 0 6px" }}>Five-slide outline</h4>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: "var(--t-sm)" }}>
                {brief.slides.map((s) => (
                  <li key={s.title} style={{ marginBottom: 6 }}>
                    <strong>{s.title}</strong>
                    <span className="muted"> {s.bullets.join(" · ")}</span>
                  </li>
                ))}
              </ol>
              <div className="brief-actions">
                <button className="btn small ghost" onClick={() => void navigator.clipboard.writeText(canonicalJson(brief)).catch(() => undefined)}>
                  Copy result JSON
                </button>
                {purchaseId && (
                  <Link className="link" to={`/receipt/${purchaseId}`}>
                    Verify it on the receipt
                  </Link>
                )}
              </div>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
