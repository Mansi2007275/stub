import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useReadContract } from "wagmi";
import { Ticket } from "../components/Ticket";
import { EscrowTicket } from "../components/EscrowTicket";
import { Hex } from "../components/Hex";
import { escrowAbi } from "../lib/escrowAbi";
import { ESCROW_ADDRESS, NETWORK, USDC_ADDRESS, chain, isDeployed } from "../lib/config";
import { usdc } from "../lib/format";
import { useFeed } from "../lib/useFeed";
import { phaseOf, ticketOf } from "../lib/feedView";

const GUARANTEES = [
  ["Every purchase ID works once", "A paid ID can never be paid, released or refunded a second time."],
  ["The price is fixed when you pay", "Price, seller and fee are copied onto your purchase. Later changes don't touch it."],
  ["Late delivery can't take your money", "After the deadline the seller's key can no longer release funds."],
  ["Refunds go to whoever paid", "Even when an agent made the call, the USDC returns to its owner."],
  ["Agents stay inside their budget", "Per-call and daily limits are enforced by the contract, not the app."],
  ["Pausing never traps funds", "A pause stops new purchases. Releases and refunds keep working."],
];

function Check() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="none" stroke="var(--released)" strokeWidth="1.6" />
      <path d="M6 10.4l2.6 2.6L14 7.6" fill="none" stroke="var(--released)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LiveWall({ doc, source }: ReturnType<typeof useFeed>) {
  const { data: locked } = useReadContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "totalLocked", chainId: chain.id, query: { enabled: isDeployed, refetchInterval: 8_000 } });
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const items = doc?.items.slice(0, 6) ?? [];

  // Tickets that appear after the first load get the printing animation.
  useEffect(() => {
    if (!doc) return;
    const ids = doc.items.map((i) => i.purchaseId);
    if (seen.current) {
      const prev = seen.current;
      setFresh(new Set(ids.filter((id) => !prev.has(id))));
    }
    seen.current = new Set(ids);
  }, [doc]);

  const t = doc?.totals;
  return (
    <section className="block" aria-labelledby="live">
      <div className="wrap">
        <div className="live-head">
          <h2 id="live">On Arc right now</h2>
          <span className={`live-dot ${doc ? "on" : ""}`}>{doc ? (source === "api" ? "Live from the escrow" : "Live, recent blocks") : isDeployed ? "Connecting to Arc" : "Escrow not deployed"}</span>
        </div>
        <dl className="stats">
          <div>
            <dt>Paid calls</dt>
            <dd>{t ? t.purchases : "—"}</dd>
          </div>
          <div>
            <dt>Released to sellers</dt>
            <dd>{t ? `${usdc(BigInt(t.volumeReleased))}` : "—"}<small> USDC</small></dd>
          </div>
          <div>
            <dt>Refunded</dt>
            <dd>{t ? t.refunded : "—"}</dd>
          </div>
          <div>
            <dt>In escrow now</dt>
            <dd>{locked !== undefined ? usdc(locked) : "—"}<small> USDC</small></dd>
          </div>
        </dl>

        {items.length === 0 ? (
          <div className="wall-empty">
            <p>No tickets yet. The first paid call on this escrow prints here.</p>
            <Link className="btn" to="/try">
              Print the first ticket
            </Link>
          </div>
        ) : (
          <ul className="wall">
            {items.map((i, n) => (
              <li key={i.purchaseId} className={fresh.has(i.purchaseId) ? "printing" : ""}>
                <Link to={`/receipt/${i.purchaseId}`} aria-label={`Receipt ${i.purchaseId}`}>
                  <EscrowTicket compact phase={phaseOf(i)} data={ticketOf(i)} seed={(n % 4) + 1} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function Home() {
  const feed = useFeed();
  const { doc } = feed;
  const latest = doc?.items.find((i) => i.status === "Released") ?? doc?.items[0];

  return (
    <>
      <section className="hero">
        <div className="wrap">
          <div>
            <h1>
              Charge per API call.
              <span className="line2">Get paid when the answer arrives.</span>
            </h1>
            <p className="lede">
              Stub holds USDC in escrow on Arc for every request. The seller is paid when the result is delivered. If it never comes, the buyer takes the money back.
            </p>
            <div className="actions">
              <Link className="btn" to="/try">
                Try a paid call
              </Link>
              <Link className="link" to="/merchant">
                Sell your API
              </Link>
            </div>
          </div>
          {latest ? <Ticket data={ticketOf(latest)} phase={phaseOf(latest)} /> : <Ticket />}
        </div>
      </section>

      <LiveWall {...feed} />

      <section className="block" aria-labelledby="settle">
        <div className="wrap">
          <h2 id="settle">How a call settles</h2>
          <p className="intro">Three steps, all on Arc. Arc finalises in under a second, so the whole thing feels like a normal API call.</p>
          <div className="ledger">
            <div className="ledger-step">
              <span className="idx">Step 1</span>
              <h3>Lock</h3>
              <p>The buyer pays the listed price into escrow with a fresh purchase ID and a hash of their input.</p>
            </div>
            <div className="ledger-step">
              <span className="idx">Step 2</span>
              <h3>Deliver</h3>
              <p>The seller's gateway runs the request and posts a hash of the result before the deadline.</p>
            </div>
            <div className="ledger-step">
              <div className="outcome release">
                <span className="idx">Step 3, delivered</span>
                <h3>Release</h3>
                <p>97% goes to the seller and 3% to the protocol, in the same transaction.</p>
                <div className="split-bar" aria-hidden="true">
                  <i />
                  <i />
                </div>
              </div>
              <div className="outcome refund">
                <span className="idx">Step 3, not delivered</span>
                <h3>Refund</h3>
                <p>After the deadline the payer reclaims the full amount. Sellers can also refund early.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="block" aria-labelledby="agents">
        <div className="wrap two-col">
          <div>
            <h2 id="agents">Give your agent a budget, not your wallet</h2>
            <p className="intro" style={{ marginBottom: 24 }}>
              Set how much an agent may spend per call and per day. It buys services on its own, can't go past the limit, and every refund comes back to you.
            </p>
            <Link className="link" to="/agents">
              Set an agent budget
            </Link>
          </div>
          <figure className="ration" aria-label="How an agent's daily budget is punched">
            <div className="ration-head">
              <strong>Daily allowance</strong>
              <span>0.05 per call · 0.25 per day</span>
            </div>
            <div className="punches" aria-hidden="true">
              {[1, 1, 1, 0, 0].map((used, i) => (
                <span key={i} className={used ? "punched" : ""} />
              ))}
            </div>
            <figcaption>Each paid call punches one slot. When the card is full, the contract rejects the next purchase until 00:00 UTC.</figcaption>
          </figure>
        </div>
      </section>

      <section className="block" aria-labelledby="build">
        <div className="wrap">
          <h2 id="build">Build on Stub</h2>
          <p className="intro">Buy from any script or agent. Sell any function. Same escrow, same guarantees.</p>
          <div className="code-pair">
            <div className="code-card">
              <span className="code-label">Buy, with @stub/sdk</span>
              <pre>
                <code>{`const stub = new StubClient({ apiBase, escrow,
  publicClient, walletClient });

const { result, fulfillTx } = await stub.buy({
  serviceId: 1n, input: idea, maxPrice: 100_000n });`}</code>
              </pre>
            </div>
            <div className="code-card">
              <span className="code-label">Sell, with @stub/paywall</span>
              <pre>
                <code>{`const paywall = stubPaywall({ escrow, serviceId: 2n,
  fulfillerKey, rpcUrl, chain,
  handler: async (input) => myApi(input) });

export const POST = paywall.fetch;`}</code>
              </pre>
            </div>
          </div>
          <p className="build-note">
            <Link className="link" to="/deck">
              See Deck Builder
            </Link>{" "}
            — a separate app that buys its pitch analysis from Stub and turns it into slides.
          </p>
        </div>
      </section>

      <section className="block" aria-labelledby="rules">
        <div className="wrap">
          <h2 id="rules">Enforced by the contract, not by trust</h2>
          <div className="guarantees">
            {GUARANTEES.map(([t, d]) => (
              <div className="guarantee" key={t}>
                <Check />
                <div>
                  <strong>{t}</strong>
                  <span>{d}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="test-count">
            Covered by 45 contract tests (fuzzing and invariants that escrow always holds exactly what is locked) and 36 end-to-end tests of the gateway, SDK and paywall.
          </p>
        </div>
      </section>

      <section className="block" aria-labelledby="onchain">
        <div className="wrap">
          <h2 id="onchain">On {chain.name}</h2>
          <dl className="proof">
            <div>
              <dt>Escrow contract</dt>
              <dd>{ESCROW_ADDRESS ? <Hex value={ESCROW_ADDRESS} /> : <span className="muted">Not deployed yet</span>}</dd>
            </div>
            <div>
              <dt>Settles in</dt>
              <dd>
                <Hex value={USDC_ADDRESS} /> USDC
              </dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>
                {NETWORK === "mainnet" ? "Mainnet" : "Testnet"}, chain {chain.id}
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  );
}
