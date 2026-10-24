import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Link } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "./lib/wagmi";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Try } from "./pages/Try";
import { Agents } from "./pages/Agents";
import { Merchant } from "./pages/Merchant";
import { Receipt } from "./pages/Receipt";
import { Deck } from "./pages/Deck";
import "./styles/global.css";

function NotFound() {
  return (
    <div className="wrap page-head">
      <h1>Page not found</h1>
      <p>
        <Link className="link" to="/">
          Back to Stub
        </Link>
      </p>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/try", element: <Try /> },
      { path: "/agents", element: <Agents /> },
      { path: "/merchant", element: <Merchant /> },
      { path: "/receipt/:id", element: <Receipt /> },
      { path: "/deck", element: <Deck /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
