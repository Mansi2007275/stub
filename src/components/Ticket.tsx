import { useEffect, useState } from "react";
import { EscrowTicket, type TicketData, type TicketPhase } from "./EscrowTicket";

const ORDER: TicketPhase[] = ["locked", "delivered", "released"];
const LABEL: Record<string, string> = { locked: "Locked", delivered: "Delivered", released: "Released" };

/**
 * Hero centrepiece. With `data` it shows the latest real purchase from the chain.
 * Without it, a clearly-marked sample walks through Locked → Delivered → Released.
 */
export function Ticket({ data, phase }: { data?: TicketData; phase?: TicketPhase }) {
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [demo, setDemo] = useState<TicketPhase>(reduce ? "released" : "locked");

  useEffect(() => {
    if (data || reduce) return;
    const durations: Record<string, number> = { locked: 2200, delivered: 1900, released: 3200 };
    const t = setTimeout(() => setDemo(ORDER[(ORDER.indexOf(demo) + 1) % ORDER.length]), durations[demo]);
    return () => clearTimeout(t);
  }, [demo, reduce, data]);

  const shown = data && phase ? phase : demo;
  return (
    <div className="ticket-stage">
      <EscrowTicket
        phase={shown}
        sample={!data}
        data={data ?? { purchaseId: "0x9f3a00000000000000000000000000000000000000000000000000000000c41e", resultHash: "0xd07c000000000000000000000000000000000000000000000000000000006a1f", inputHash: "0x4be1000000000000000000000000000000000000000000000000000000009d2" }}
      />
      <div className="ticket-caption" aria-live="polite">
        {data ? (
          <span>Latest purchase on Arc</span>
        ) : (
          ORDER.map((p) => (
            <span key={p} aria-current={demo === p ? "step" : undefined}>
              {LABEL[p]}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
