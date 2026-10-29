import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // host pinned to IPv4: dev-server.ts proxies to 127.0.0.1, and Vite otherwise
  // binds IPv6-only (::1) here, which makes that proxy fail to connect.
  server: { host: "127.0.0.1", port: 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          web3: ["viem", "wagmi", "@tanstack/react-query"],
          react: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
});
