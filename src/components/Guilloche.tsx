import { useMemo } from "react";

/** Security-print linework (hypotrochoid rosettes), like the background of a cheque or banknote. */
export function Guilloche({ seed = 0, rings = 14, className = "guilloche" }: { seed?: number; rings?: number; className?: string }) {
  const paths = useMemo(() => {
    const out: string[] = [];
    const W = 600;
    const H = 320;
    for (let r = 0; r < rings; r++) {
      const R = 150 + r * 9;
      const rr = 37 + ((r + seed) % 5) * 3;
      const d = 52 + r * 2.2;
      const cx = W * 0.62;
      const cy = H * 0.5;
      let p = "";
      const steps = 900;
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI * 2 * 12;
        const x = (R - rr) * Math.cos(t) + d * Math.cos(((R - rr) / rr) * t);
        const y = (R - rr) * Math.sin(t) - d * Math.sin(((R - rr) / rr) * t);
        p += `${i === 0 ? "M" : "L"}${(cx + x * 0.95).toFixed(1)} ${(cy + y * 0.55).toFixed(1)}`;
      }
      out.push(p);
    }
    return out;
  }, [seed, rings]);

  return (
    <svg className={className} viewBox="0 0 600 320" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--guilloche)" strokeWidth={0.45} opacity={0.35 + (i % 3) * 0.12} />
      ))}
    </svg>
  );
}
