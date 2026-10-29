import { Guilloche } from "./Guilloche";
import { shortHex, usdc } from "../lib/format";

export type TicketPhase = "draft" | "printing" | "locked" | "delivered" | "released" | "refunded";

export type TicketData = {
  amount?: bigint;
  purchaseId?: string;
  payer?: string;
  inputHash?: string;
  resultHash?: string;
  deadline?: bigint;
  merchantAmount?: bigint;
  feeAmount?: bigint;
  serviceName?: string;
  feeBps?: number;
};

const STAMP: Partial<Record<TicketPhase, string>> = { locked: "Locked", delivered: "Delivered", released: "Released", refunded: "Refunded" };

/**
 * One escrow purchase drawn as a security-printed ticket. The stub on the right is what the seller
 * tears off when the call is released. Always rendered from real on-chain data: anything the chain
 * has not told us yet is shown as "-", never invented.
 */
export function EscrowTicket({
  phase,
  data,
  compact = false,
  seed = 2,
}: {
  phase: TicketPhase;
  data: TicketData;
  compact?: boolean;
  seed?: number;
}) {
  // Only derive a split when the chain has given us both an amount and a fee rate.
  const amount = data.amount;
  const fee = data.feeAmount ?? (amount !== undefined && data.feeBps !== undefined ? (amount * BigInt(data.feeBps)) / 10_000n : undefined);
  const merchant = data.merchantAmount ?? (amount !== undefined && fee !== undefined ? amount - fee : undefined);
  const money = (v?: bigint) => (v === undefined ? "-" : usdc(v));
  const delivered = phase === "delivered" || phase === "released";
  const deadline = data.deadline ? new Date(Number(data.deadline) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "10 min after lock";

  return (
    <div className={`ticket ${compact ? "compact" : ""}`} data-phase={phase} aria-label={`Escrow ticket, ${STAMP[phase] ?? "not paid yet"}`}>
      <div className="ticket-body">
        <Guilloche seed={seed} />
        <div className="ticket-content">
          <div className="ticket-row">
            <div>
              <div className="ticket-issuer">Stub escrow</div>
              <div className="ticket-serial">
                No. {data.purchaseId ? shortHex(data.purchaseId, 6, 4) : "—"}
              </div>
            </div>
          </div>
          <div className="ticket-amount">
            {money(amount)}
            <small>USDC</small>
          </div>
          <div className="ticket-for">for one call to {data.serviceName ?? "Pitch Brief Analyzer"}</div>
          {!compact && (
            <dl className="ticket-fields">
              <div>
                <dt>Payer</dt>
                <dd className={data.payer ? "" : "pending"}>{data.payer ? shortHex(data.payer) : "your wallet"}</dd>
              </div>
              <div>
                <dt>Deliver by</dt>
                <dd>{deadline}</dd>
              </div>
              <div>
                <dt>Input hash</dt>
                <dd className={data.inputHash ? "" : "pending"}>{data.inputHash ? shortHex(data.inputHash) : "set at payment"}</dd>
              </div>
              <div>
                <dt>Result hash</dt>
                <dd className={delivered && data.resultHash ? "" : "pending"}>{delivered && data.resultHash ? shortHex(data.resultHash) : phase === "refunded" ? "not delivered" : "waiting"}</dd>
              </div>
            </dl>
          )}
        </div>
      </div>

      <div className="ticket-stub">
        <Guilloche seed={seed + 2} rings={8} />
        <div className="ticket-content">
          <div className="stub-label">{phase === "refunded" ? "Returned to payer" : "Seller receives"}</div>
          <div className="stub-value">{phase === "refunded" ? money(amount) : money(merchant)}</div>
          <div className="stub-to">{phase === "refunded" ? "full amount" : data.feeBps === undefined ? "on delivery" : `${(10_000 - data.feeBps) / 100}% on delivery`}</div>
        </div>
        {phase !== "refunded" && (
          <div className="ticket-content">
            <div className="stub-label">Protocol</div>
            <div className="stub-value small">{money(fee)}</div>
          </div>
        )}
      </div>

      {(Object.keys(STAMP) as TicketPhase[]).map((p) => (
        <span key={p} className={`stamp ${p} ${phase === p ? "show" : ""}`} aria-hidden="true">
          {STAMP[p]}
        </span>
      ))}
    </div>
  );
}
