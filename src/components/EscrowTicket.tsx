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
 * tears off when the call is released. Used with real on-chain data everywhere except the hero sample.
 */
export function EscrowTicket({
  phase,
  data,
  sample = false,
  compact = false,
  seed = 2,
}: {
  phase: TicketPhase;
  data: TicketData;
  sample?: boolean;
  compact?: boolean;
  seed?: number;
}) {
  const amount = data.amount ?? 50_000n;
  const fee = data.feeAmount ?? (amount * BigInt(data.feeBps ?? 300)) / 10_000n;
  const merchant = data.merchantAmount ?? amount - fee;
  const delivered = phase === "delivered" || phase === "released";
  const deadline = data.deadline ? new Date(Number(data.deadline) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "10 min after lock";

  return (
    <div className={`ticket ${compact ? "compact" : ""}`} data-phase={phase} aria-label={`${sample ? "Sample" : "Escrow"} ticket, ${STAMP[phase] ?? "not paid yet"}`}>
      <div className="ticket-body">
        <Guilloche seed={seed} />
        <div className="ticket-content">
          <div className="ticket-row">
            <div>
              <div className="ticket-issuer">Stub escrow</div>
              <div className="ticket-serial">
                No. {data.purchaseId ? shortHex(data.purchaseId, 6, 4) : "—"}
                {sample && <span className="sample-tag">Sample</span>}
              </div>
            </div>
          </div>
          <div className="ticket-amount">
            {usdc(amount)}
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
          <div className="stub-value">{phase === "refunded" ? usdc(amount) : usdc(merchant)}</div>
          <div className="stub-to">{phase === "refunded" ? "full amount" : "97% on delivery"}</div>
        </div>
        {phase !== "refunded" && (
          <div className="ticket-content">
            <div className="stub-label">Protocol</div>
            <div className="stub-value small">{usdc(fee)}</div>
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
