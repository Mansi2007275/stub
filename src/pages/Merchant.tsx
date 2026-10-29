import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { isAddress, keccak256, parseUnits, stringToBytes, type Address } from "viem";
import { escrowAbi } from "../lib/escrowAbi";
import { ESCROW_ADDRESS, MAX_PER_CALL, MIN_USDC, USDC_DECIMALS, chain, isDeployed } from "../lib/config";
import { usdc } from "../lib/format";
import { Hex } from "../components/Hex";
import { useFeed } from "../lib/useFeed";
import { useFeeBps } from "../lib/useChainFacts";

type Service = { id: bigint; fulfiller: Address; price: bigint; timeout: number; active: boolean };

/** Services this wallet sells, read straight from the escrow. */
function useMyServices(merchant?: Address, reloadKey = 0) {
  const client = usePublicClient({ chainId: chain.id });
  const [rows, setRows] = useState<Service[] | null>(null);
  useEffect(() => {
    if (!client || !ESCROW_ADDRESS || !merchant) return;
    let live = true;
    void (async () => {
      try {
        const count = await client.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "serviceCount" });
        const out: Service[] = [];
        for (let i = 1n; i <= count; i++) {
          const [m, fulfiller, price, timeout, active] = await client.readContract({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "services", args: [i] });
          if (m.toLowerCase() === merchant.toLowerCase()) out.push({ id: i, fulfiller, price, timeout, active });
        }
        if (live) setRows(out);
      } catch {
        if (live) setRows([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [client, merchant, reloadKey]);
  return rows;
}

export function Merchant() {
  const { address, isConnected } = useAccount();
  const disabled = !isDeployed || !isConnected;
  const [price, setPrice] = useState("");
  const [timeout, setTimeoutS] = useState("600");
  const [fulfiller, setFulfiller] = useState("");
  const reg = useWriteContract();
  const done = useWaitForTransactionReceipt({ hash: reg.data, chainId: chain.id });
  const services = useMyServices(address, done.isSuccess ? 1 : 0);
  const { doc } = useFeed();
  const { sellerPct } = useFeeBps();

  const mine = useMemo(() => new Set((services ?? []).map((s) => s.id.toString())), [services]);
  const rows = useMemo(() => (doc?.items ?? []).filter((i) => mine.has(i.serviceId)), [doc, mine]);
  const earned = rows.reduce((a, r) => a + (r.merchantAmount ? BigInt(r.merchantAmount) : 0n), 0n);
  const refunds = rows.filter((r) => r.status === "Refunded").length;
  const pending = rows.filter((r) => r.status === "Locked").length;

  const t = Number(timeout);
  const hint = !fulfiller ? "" : !isAddress(fulfiller) ? "That isn't an address." : fulfiller.toLowerCase() === address?.toLowerCase() ? "Use a separate gateway wallet, not this one." : "";
  // MIN_TIMEOUT/MAX_TIMEOUT mirror the contract; the price has no ceiling there (uint96), so the
  // only floor is what USDC can express at 6 decimals.
  const priceOverMax = MAX_PER_CALL !== undefined && Number(price) > MAX_PER_CALL;
  const valid = isAddress(fulfiller) && fulfiller.toLowerCase() !== address?.toLowerCase() && Number(price) >= MIN_USDC && !priceOverMax && t >= 60 && t <= 604800;

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Sell an <span className="hl">API</span></h1>
        <p>
          List a service, set a price per call, and get paid in USDC each time your gateway delivers a result. Running your own API? Wrap it with{" "}
          <span className="mono">stubPaywall()</span> from <span className="mono">packages/paywall</span>.
        </p>
      </div>

      {disabled && (
        <div className="notice">
          <strong>{!isDeployed ? "Escrow not deployed yet." : "Connect your wallet"}</strong> {!isDeployed ? "Set VITE_ESCROW_ADDRESS after deploying." : "to list a service."}
        </div>
      )}

      <div className="grid-2">
        <form
          className="panel pb-yellow"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || !ESCROW_ADDRESS) return;
            reg.writeContract({
              address: ESCROW_ADDRESS,
              abi: escrowAbi,
              functionName: "registerService",
              args: [fulfiller, parseUnits(price, USDC_DECIMALS), t, keccak256(stringToBytes("stub:pitch-brief:v1"))],
              chainId: chain.id,
            });
          }}
        >
          <h2>List a service</h2>
          <div className="field">
            <label htmlFor="price">Price per call</label>
            <input id="price" inputMode="decimal" placeholder="0.000000" disabled={disabled} value={price} onChange={(e) => setPrice(e.target.value)} />
            <span className="hint">{sellerPct ? `In USDC. You receive ${sellerPct}.` : "In USDC, 6 decimals."}</span>
          </div>
          <div className="field">
            <label htmlFor="timeout">Time to deliver</label>
            <input id="timeout" inputMode="numeric" disabled={disabled} value={timeout} onChange={(e) => setTimeoutS(e.target.value)} />
            <span className="hint">Seconds, between 60 and 604800. After this the buyer can refund.</span>
          </div>
          <div className="field">
            <label htmlFor="fulfiller">Gateway address</label>
            <input id="fulfiller" placeholder="0x…" disabled={disabled} spellCheck={false} value={fulfiller} onChange={(e) => setFulfiller(e.target.value.trim())} />
            <span className={`hint ${hint ? "warn" : ""}`}>{hint || "The key your server uses to confirm delivery. Keep it separate from this wallet."}</span>
          </div>
          <button className="btn" disabled={disabled || !valid || reg.isPending}>
            {reg.isPending ? "Confirm in wallet" : done.isSuccess ? "Listed" : "List service"}
          </button>
          {done.isSuccess && reg.data && (
            <p style={{ fontSize: "var(--t-sm)" }}>
              Listed in <Hex value={reg.data} kind="tx" />.
            </p>
          )}
          {reg.error && <p className="form-error">{reg.error.message.split("\n")[0]}</p>}
        </form>

        <div className="stack">
        <div className="panel pb-lilac">
          <h2>Your services</h2>
          {!address ? (
            <div className="empty">Connect your wallet to see what you sell.</div>
          ) : services === null ? (
            <div className="empty">Reading services from Arc</div>
          ) : services.length === 0 ? (
            <div className="empty">You haven't listed a service on this escrow yet.</div>
          ) : (
            <ul className="calls">
              {services.map((s) => (
                <li key={s.id.toString()}>
                  <span>
                    Service #{s.id.toString()} <span className="muted">· gateway</span> <Hex value={s.fulfiller} />
                  </span>
                  <span className="amt">{usdc(s.price)}</span>
                  <span className={`tag ${s.active ? "ok" : "no"}`}>{s.active ? "Live" : "Paused"}</span>
                </li>
              ))}
            </ul>
          )}

        </div>

        <div className="panel pb-mint">
          <h2>Earnings</h2>
          <dl className="stats mini">
            <div>
              <dt>Earned</dt>
              <dd>
                {usdc(earned)}
                <small> USDC</small>
              </dd>
            </div>
            <div>
              <dt>Awaiting delivery</dt>
              <dd>{pending}</dd>
            </div>
            <div>
              <dt>Refunds</dt>
              <dd>{refunds}</dd>
            </div>
          </dl>
          {rows.length === 0 ? (
            <div className="empty">Released payments and refunds show up here once buyers start calling.</div>
          ) : (
            <ul className="calls">
              {rows.slice(0, 20).map((r) => (
                <li key={r.purchaseId}>
                  <Link to={`/receipt/${r.purchaseId}`} className="mono">
                    {r.purchaseId.slice(0, 10)}…
                  </Link>
                  <span className="amt">{usdc(BigInt(r.merchantAmount ?? r.amount))}</span>
                  <span className={`tag ${r.status === "Released" ? "ok" : r.status === "Refunded" ? "no" : "wait"}`}>{r.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
