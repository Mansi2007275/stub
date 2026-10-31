import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import type { Account, Chain, PublicClient, Transport, WalletClient } from "viem";
import { API_BASE, ESCROW_ADDRESS, EXPLORER, SERVICE_ID, USDC_ADDRESS, chain, isDeployed } from "../lib/config";
import { StubClient, StubError, localStoragePending } from "../../packages/sdk/src/index";
import { createDeckBuilder, memoryJobs, renderDeckHtml, templateDeck, type Job } from "../../apps/deck-builder/src/deck";
import { Hex } from "../components/Hex";
import { ERRORS } from "../lib/payCall";
import { useServicePrice } from "../lib/useChainFacts";
import { usdc } from "../lib/format";

/**
 * Deck Builder, running in the browser. It is a *consumer* of Stub: it buys a pitch brief through
 * @stub/sdk (your wallet pays the seller's listed price into escrow), then builds the slides from it.
 */
export function Deck() {
  const { isConnected, chainId } = useAccount();
  const { data: wallet } = useWalletClient({ chainId: chain.id });
  const client = usePublicClient({ chainId: chain.id });
  const [idea, setIdea] = useState("");
  const [useStub, setUseStub] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  // The price is read from the escrow, never stated as a constant.
  const price = useServicePrice();
  const priceLabel = price === undefined ? "the listed price" : `${usdc(price)} USDC`;
  const jobs = useMemo(() => memoryJobs(), []);

  const onChain = chainId === chain.id;
  const ready = idea.trim().length >= 20 && !busy && (!useStub || (isDeployed && isConnected && onChain && !!wallet && !!client));

  async function build() {
    setBusy(true);
    setJob(null);
    setStage(useStub ? "Buying the brief from Stub" : "Building without Stub");
    try {
      const stub =
        useStub && wallet && client && ESCROW_ADDRESS
          ? new StubClient({
              apiBase: API_BASE,
              escrow: ESCROW_ADDRESS,
              usdc: USDC_ADDRESS,
              publicClient: client as PublicClient,
              walletClient: wallet as WalletClient<Transport, Chain, Account>,
              pending: localStoragePending("stub:deck:"),
            })
          : undefined;
      const builder = createDeckBuilder({ jobs, generate: templateDeck, useStub, stub, serviceId: SERVICE_ID });
      const out = await builder.run(`deck-${useStub ? "stub" : "plain"}-${idea.trim().length}-${idea.trim().slice(0, 24)}`, idea.trim());
      setJob(out);
    } catch (e) {
      setJob({ id: "x", idea, status: "failed", useStub, createdAt: 0, updatedAt: 0, error: (e as StubError).code ?? (e as Error).message });
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  const download = () => {
    if (!job) return;
    const blob = new Blob([renderDeckHtml(job, EXPLORER)], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(job.deck?.title ?? "deck").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="wrap">
      <div className="page-head">
        <span className="app-chip">An app built on Stub</span>
        <h1>Deck <span className="hl">Builder</span></h1>
        <p>
          Deck Builder doesn't write analysis itself. It buys a pitch brief from Stub for {priceLabel}, then turns it into slides. If the brief never arrives, the escrow refunds you and no deck is made.
        </p>
      </div>

      <div className="grid-deck">
        <div className="panel pb-yellow">
          <h2>Your idea</h2>
          <div className="field">
            <label htmlFor="deck-idea">What are you pitching?</label>
            <textarea id="deck-idea" maxLength={4000} value={idea} disabled={busy} onChange={(e) => setIdea(e.target.value)} placeholder="A booking tool that lets community halls rent out idle evenings" />
            <span className="hint">{idea.length}/4000. At least 20 characters.</span>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={useStub} disabled={busy} onChange={(e) => setUseStub(e.target.checked)} />
            <span>Buy the analysis from Stub</span>
          </label>
          <p className="hint">{useStub ? "On: buy an analyst brief, then build slides from it." : "Off: build from your idea alone, with no payment."}</p>
          <button className="btn" style={{ width: "100%", marginTop: 12 }} disabled={!ready} onClick={() => void build()}>
            {busy ? stage : useStub ? `Pay ${priceLabel} and build deck` : "Build deck without Stub"}
          </button>
          {useStub && isConnected && !onChain && <p className="form-error">Switch your wallet to {chain.name}.</p>}
          {job?.status === "failed" && <p className="form-error">{ERRORS[job.error ?? ""] ?? `Couldn't build the deck: ${job.error}`}</p>}
          {job?.status === "failed" && job.purchaseId && (
            <p><Link to={`/receipt/${job.purchaseId}`}>View this purchase's status and refund eligibility</Link></p>
          )}

          {job?.stub && (
            <div className="evidence">
              <h3>Bought from Stub</h3>
              <dl className="kv">
                <dt>Purchase</dt>
                <dd>
                  <Link to={`/receipt/${job.stub.purchaseId}`} className="mono">
                    {job.stub.purchaseId.slice(0, 12)}…
                  </Link>
                </dd>
                <dt>Locked</dt>
                <dd>{job.stub.lockTx ? <Hex value={job.stub.lockTx} kind="tx" /> : <span className="muted">resumed</span>}</dd>
                <dt>Released</dt>
                <dd>{job.stub.fulfillTx ? <Hex value={job.stub.fulfillTx} kind="tx" /> : <span className="muted">earlier</span>}</dd>
              </dl>
            </div>
          )}
        </div>

        <div className="deck-stage">
          {!job?.deck ? (
            <div className="empty deck-empty">{busy ? stage : "Slides appear here."}</div>
          ) : (
            <>
              <div className="deck-head">
                <h2>{job.deck.title}</h2>
                <button className="btn small ghost" onClick={download}>
                  Download deck
                </button>
              </div>
              <ol className="slides">
                {job.deck.slides.map((s, i) => (
                  <li key={`${s.title}-${i}`} className="slide">
                    <span className="slide-n">{i + 1}</span>
                    <h3>{s.title}</h3>
                    <ul>
                      {s.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                    {job.stub && i > 0 && <span className="slide-src">from Stub brief</span>}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
