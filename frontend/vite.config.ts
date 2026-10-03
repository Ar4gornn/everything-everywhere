/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
// Vitest's own defineConfig — Vite's UserConfigExport has no `test` key, and using it
// here fails the type build.
import { defineConfig } from "vitest/config";
import { landingPages } from "./landing/vitePlugin.ts";

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react(), landingPages()],
  // .env lives at the repository root, next to docker-compose.yml, and is shared with the
  // backend. Vite otherwise looks in this directory and a production build would silently
  // fall back to a same-origin API base.
  envDir: "..",
  build: {
    // The app plus four prerendered landing pages (AD-66); the stubs hold only a marker.
    rollupOptions: {
      input: {
        index: at("./index.html"),
        landing: at("./landing.html"),
        landingFr: at("./fr/index.html"),
        privacy: at("./privacy/index.html"),
        privacyFr: at("./fr/privacy/index.html"),
      },
    },
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
  },
});
