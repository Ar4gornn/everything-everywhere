/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
// Vitest's own defineConfig — Vite's UserConfigExport has no `test` key, and using it
// here fails the type build.
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // .env lives at the repository root, next to docker-compose.yml, and is shared with the
  // backend. Vite otherwise looks in this directory and a production build would silently
  // fall back to a same-origin API base.
  envDir: "..",
  build: {
    // Fonts under 4 KB would otherwise be inlined as data: URIs, which the production
    // CSP (ops/Caddyfile, no font-src) blocks. Other small assets keep the default.
    assetsInlineLimit: (filePath) => (/\.(woff2?|ttf|otf)$/.test(filePath) ? false : undefined),
  },
  server: {
    port: 5173,
    // The dev server proxies /api so the browser sees one origin locally, while the
    // production build talks to VITE_API_BASE_URL across an origin boundary (AD-14).
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE_URL ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // 10s, not 5s: pages that render the whole shell (sidebar, drawer, Settings with its
    // hundreds of options) ran past 5s on a loaded machine with every assertion passing.
    testTimeout: 10000,
  },
});
