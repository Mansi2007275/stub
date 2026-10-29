import { NavLink, Outlet } from "react-router-dom";
import { NETWORK } from "../lib/config";
import { ConnectButton } from "./ConnectButton";

const LINKS = [
  { to: "/try", label: "Try a call", short: "Try" },
  { to: "/agents", label: "Agent budgets", short: "Agents" },
  { to: "/merchant", label: "Sell an API", short: "Sell" },
  { to: "/deck", label: "Deck Builder", short: "Deck" },
];

export function Mark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <path
        d="M21.4 10.3c-1.4-1.1-3.2-1.7-5.2-1.7-3.1 0-5.2 1.5-5.2 3.7 0 2.1 1.7 3.2 5 3.8 3.4.7 5.4 1.8 5.4 4.3 0 2.5-2.3 4.3-5.7 4.3-2.3 0-4.3-.7-5.8-2.1"
        fill="none"
        stroke="var(--yellow)"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Layout() {
  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <NavLink to="/" className="wordmark" aria-label="Stub home">
            <Mark />
            Stub
          </NavLink>
          <nav className="nav" aria-label="Main">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <span className="net-pill" data-net={NETWORK}>
            Arc {NETWORK === "mainnet" ? "Mainnet" : "Testnet"}
          </span>
          <ConnectButton />
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="wrap">
          <span>Stub by 0xalgos. USDC escrow for API calls on Arc.</span>
          <span>
            Contracts are unaudited. Use small amounts.
          </span>
        </div>
      </footer>

      <nav className="mobile-nav" aria-label="Mobile">
        <NavLink to="/" end>
          Home
        </NavLink>
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to}>
            {l.short}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
