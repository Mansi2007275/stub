import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { isHex, size, type Hex } from "viem";
import { escrowAbi } from "../lib/escrowAbi";
import { ESCROW_ADDRESS, chain, explorerAddress, isDeployed } from "../lib/config";
import { STATUS, usdc } from "../lib/format";
import { Hex as HexText } from "../components/Hex";
import { EscrowTicket, type TicketPhase } from "../components/EscrowTicket";
import { resultHashOf } from "../../shared/protocol";

type Verdict = { kind: "match" | "mismatch" | "invalid"; hash?: Hex };

/** Paste the JSON you received; we recompute keccak256(canonical JSON) and compare it with the on-chain hash. */
function VerifyResult({ onchain }: { onchain: Hex }) {
  const [text, setText] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const check = () => {
    try {
      const parsed: unknown = JSON.parse(text);
      // Accept either the bare result or the full /api/call response.
      const result = parsed && typeof parsed === "object" && "result" in parsed && "resultHash" in parsed ? (parsed as { result: unknown }).result : parsed;
      const hash = resultHashOf(result);
      setVerdict({ kind: hash.toLowerCase() === onchain.toLowerCase() ? "match" : "mismatch", hash });
    } catch {
      setVerdict({ kind: "invalid" });
    }
  };
  return (
    <div className="verify">
      <h2>Verify the result</h2>
      <p className="muted">Paste the JSON you received. Stub recomputes its hash in your browser and compares it with the hash the seller posted on-chain.</p>
      <div className="field">
        <label htmlFor="result-json">Result JSON</label>
        <textarea id="result-json" spellCheck={false} value={text} onChange={(e) => (setText(e.target.value), setVerdict(null))} placeholder='{"title": "…", "problem": "…"}' />
      </div>
      <button className="btn ghost" disabled={!text.trim()} onClick={check}>
        Check against the chain
      </button>
      {verdict && (
        <p role="status" className={`verdict ${verdict.kind}`}>
          {verdict.kind === "match" && "Match. This is exactly the result the seller was paid for."}
          {verdict.kind === "mismatch" && (
            <>
              No match. This JSON hashes to <span className="mono">{verdict.hash?.slice(0, 18)}…</span>, which is not what was released.
            </>
          )}
          {verdict.kind === "invalid" && "That isn't valid JSON."}
        </p>
      )}
    </div>
  );
}

function Share({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/receipt/${id}` : "";
  const text = "Paid per API call in USDC on @arc, released only when the result arrived. Receipt:";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="share">
      <button className="btn small ghost" onClick={() => void copy()}>
        {copied ? "Link copied" : "Copy receipt link"}
      </button>
      <a className="btn small" target="_blank" rel="noreferrer" href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}>
        Share on X
      </a>
    </div>
  );
}

/** Public receipt: everything is read straight from the escrow contract. */
export function Receipt() {
  const { id = "" } = useParams();
  const valid = isHex(id) && size(id) === 32;

  const { data, isLoading, error, refetch } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "getPurchase",
    chainId: chain.id,
    args: valid ? [id] : undefined,
    query: { enabled: isDeployed && valid, refetchInterval: 5_000 },
  });

  const { address } = useAccount();
  const { writeContract, data: refundTx, isPending, error: refundError } = useWriteContract();
  const { data: refundReceipt } = useWaitForTransactionReceipt({ hash: refundTx, chainId: chain.id });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const status = data ? STATUS[data.status] : undefined;
  const refunded = status === "Refunded";
  const refundPending = !!refundTx && status === "Locked" && refundReceipt?.status !== "reverted";
  const me = address?.toLowerCase();
  const canRefund = status === "Locked" && !!me &&
    (me === data?.payer.toLowerCase() || me === data?.buyer.toLowerCase()) &&
    now / 1000 > Number(data?.deadline ?? 0);
  const fee = data ? (data.amount * BigInt(data.feeBps)) / 10_000n : 0n;
  const phase: TicketPhase = status === "Fulfilled" ? "released" : status === "Refunded" ? "refunded" : "locked";

  return (
    <div className="wrap" style={{ paddingBottom: 72 }}>
      <div className="page-head">
        <h1><span className="hl">Receipt</span></h1>
        <p>Read live from the escrow contract on {chain.name}. Anyone with this link can check it.</p>
      </div>

      {!valid && <div className="empty">This link doesn't contain a valid purchase ID.</div>}
      {valid && !isDeployed && <div className="empty">The escrow contract isn't configured on this site yet.</div>}
      {valid && isDeployed && isLoading && <div className="empty">Reading the purchase from Arc</div>}
      {valid && error && <div className="empty">Couldn't read this purchase. Check the network and try again.</div>}
      {data && status === "None" && <div className="empty">No purchase with this ID exists on this escrow.</div>}

      {data && status !== "None" && (
        <div className="receipt-grid">
          <div>
            <div className="receipt-ticket">
              <EscrowTicket
                phase={phase}
                data={{
                  amount: data.amount,
                  purchaseId: id,
                  payer: data.payer,
                  inputHash: data.inputHash,
                  resultHash: data.resultHash,
                  deadline: data.deadline,
                  feeBps: data.feeBps,
                  serviceName: data.serviceId === 1n ? "Pitch Brief Analyzer" : `service #${data.serviceId.toString()}`,
                }}
              />
            </div>
            <Share id={id} />
          </div>

          <div className="panel">
            <dl className="kv">
              <dt>Status</dt>
              <dd>
                <span className={`tag ${status === "Fulfilled" ? "ok" : status === "Refunded" ? "no" : "wait"}`}>{status === "Fulfilled" ? "Released" : status}</span>
              </dd>
              <dt>Purchase</dt>
              <dd>
                <HexText value={id} kind="plain" />
              </dd>
              <dt>Amount</dt>
              <dd>{usdc(data.amount)} USDC</dd>
              {status === "Fulfilled" && (
                <>
                  <dt>Seller received</dt>
                  <dd>{usdc(data.amount - fee)} USDC</dd>
                  <dt>Protocol fee</dt>
                  <dd>{usdc(fee)} USDC</dd>
                </>
              )}
              <dt>Payer</dt>
              <dd>
                <HexText value={data.payer} />
              </dd>
              {data.buyer.toLowerCase() !== data.payer.toLowerCase() && (
                <>
                  <dt>Bought by agent</dt>
                  <dd>
                    <HexText value={data.buyer} />
                  </dd>
                </>
              )}
              <dt>Seller</dt>
              <dd>
                <HexText value={data.merchant} />
              </dd>
              <dt>Escrow</dt>
              <dd>
                <a href={explorerAddress(ESCROW_ADDRESS!)} target="_blank" rel="noreferrer" className="mono">
                  view on explorer
                </a>
              </dd>
              <dt>Input hash</dt>
              <dd>
                <HexText value={data.inputHash} kind="plain" />
              </dd>
              <dt>Result hash</dt>
              <dd>{status === "Fulfilled" ? <HexText value={data.resultHash} kind="plain" /> : <span className="muted">Not delivered</span>}</dd>
              <dt>Deadline</dt>
              <dd>{new Date(Number(data.deadline) * 1000).toLocaleString()}</dd>
            </dl>

            {canRefund && !refunded && (
              <div style={{ marginTop: 20 }}>
                <button
                  className="btn danger"
                  disabled={isPending || refundPending}
                  onClick={() => writeContract({ address: ESCROW_ADDRESS!, abi: escrowAbi, functionName: "refund", args: [id as Hex], chainId: chain.id })}
                >
                  {isPending ? "Confirm in wallet" : refundPending ? "Refund pending confirmation" : "Refund my USDC"}
                </button>
                <p className="muted" style={{ fontSize: "var(--t-sm)" }}>
                  The delivery deadline passed without a result, so you can take the full amount back.
                </p>
                {refundError && <p className="form-error">{refundError.message.split("\n")[0]}</p>}
                {refundReceipt?.status === "reverted" && <p className="form-error">The refund transaction reverted. Your funds remain in escrow.</p>}
              </div>
            )}
            {refunded && (
              <p style={{ marginTop: 16 }}>
                Refunded.{" "}
                <button className="link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => void refetch()}>
                  Refresh status
                </button>
              </p>
            )}

            {status === "Fulfilled" && <VerifyResult onchain={data.resultHash} />}
          </div>
        </div>
      )}
    </div>
  );
}
