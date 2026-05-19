import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// During `pnpm --filter web dev` the Vite dev server proxies API calls to the
// extension's HTTP server. Set PI_CODE_REVIEW_PORT to whatever port you
// launched the extension with (the extension respects the same env var so the
// two halves agree).
const apiPort = Number(process.env.PI_CODE_REVIEW_PORT ?? 8765);

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
