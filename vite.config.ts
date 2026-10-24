import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
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
