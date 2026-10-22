import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Stamps the build identifier into index.html (`<meta name="dk-build" content="%VITE_DK_BUILD%">`).
 * Taken from VITE_DK_BUILD in the environment or a .env file; falls back to "dev" so the placeholder
 * never ships unreplaced. Used by the deployment check to confirm which build is live.
 */
function buildMeta(id: string): Plugin {
  const safe = id.replace(/[^A-Za-z0-9._:+\-/]/g, "").slice(0, 120) || "dev";
  return { name: "dk-build-meta", transformIndexHtml: { order: "pre", handler: (html) => html.replaceAll("%VITE_DK_BUILD%", safe) } };
}

// DK_BASE lets the static demo build live under a sub-path (e.g. GitHub Pages /Digital-Kingdom/).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const build = process.env.VITE_DK_BUILD || env.VITE_DK_BUILD || "dev";
  return {
    base: process.env.DK_BASE ?? "/",
    plugins: [react(), buildMeta(build)],
    server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8787", "/healthz": "http://127.0.0.1:8787" } },
    build: {
      target: "es2022",
      sourcemap: false,
      chunkSizeWarningLimit: 1600,
      rollupOptions: { output: { manualChunks: { three: ["three"], r3f: ["@react-three/fiber", "@react-three/drei"] } } },
    },
  };
});
