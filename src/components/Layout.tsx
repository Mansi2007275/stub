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
      <rect width="32" height="32" rx="7" fill="var(--ink)" />
      <path d="M9 25V12a7 7 0 0 1 14 0v13" fill="none" stroke="var(--paper)" strokeWidth="3" />
      <path d="M9 18h14" stroke="var(--usdc)" strokeWidth="3" />
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
