import { useState } from "react";
import { explorerAddress, explorerTx } from "../lib/config";
import { shortHex } from "../lib/format";

/** A hash or address: truncated, copyable, linked to the Arc explorer. */
export function Hex({ value, kind = "address", full = false }: { value?: string; kind?: "address" | "tx" | "plain"; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="muted">—</span>;
  const text = full ? value : shortHex(value);
  const href = kind === "tx" ? explorerTx(value) : kind === "address" ? explorerAddress(value) : undefined;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked: ignore */
    }
  };

  return (
    <span className="mono" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" title={value}>
          {text}
        </a>
      ) : (
        <span title={value}>{text}</span>
      )}
      <button
        onClick={() => void copy()}
        aria-label={`Copy ${value}`}
        style={{ border: 0, background: "none", cursor: "pointer", color: "var(--ink-3)", fontSize: "0.8em", padding: 0 }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
