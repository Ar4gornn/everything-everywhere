import type { Plugin } from "vite";
import type { Lang } from "../src/i18n/catalogue.ts";
import { type Page, renderPage } from "./render.ts";

const MARKER = /<!--\s*landing:(en|fr):(home|privacy)\s*-->/;

// Replaces a stub entry (only a marker comment) with the prerendered page. order "pre" so
// Vite still hashes the script, stylesheet and images the rendered HTML references.
export function landingPages(): Plugin {
  return {
    name: "ee-landing-pages",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const m = MARKER.exec(html);
        if (!m) return html;
        return renderPage(m[1] as Lang, m[2] as Page);
      },
    },
  };
}
