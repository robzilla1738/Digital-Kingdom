import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// DK_BASE lets the static demo build live under a sub-path (e.g. GitHub Pages /Digital-Kingdom/).
export default defineConfig({
  base: process.env.DK_BASE ?? "/",
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8787", "/healthz": "http://127.0.0.1:8787" } },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: { output: { manualChunks: { three: ["three"], r3f: ["@react-three/fiber", "@react-three/drei"] } } },
  },
});
