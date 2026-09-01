import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { requireApiUrl } from "./env.defaults";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname), "");
  const backendUrl = requireApiUrl(env.VITE_API_URL);
  // Prod CORS allowlist is the deployed SPA, not localhost. Rewrite Origin so
  // the proxied request is accepted when `npm run dev` targets zetapi.
  let proxyOrigin: string | undefined;
  try {
    if (new URL(backendUrl).host === "zetapi.driftal.tech") {
      proxyOrigin = "https://zet.driftal.tech";
    }
  } catch {
    /* keep Origin as-is for local backends */
  }
  return {
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api": {
        target: backendUrl,
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        ...(proxyOrigin ? { headers: { Origin: proxyOrigin, Referer: `${proxyOrigin}/` } } : {}),
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
};
});
