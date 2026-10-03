import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ORIGIN, type Page, pagePath, renderPage } from "./render";

const here = dirname(fileURLToPath(import.meta.url));
const PAIRS: ["en" | "fr", Page][] = [
  ["en", "home"],
  ["fr", "home"],
  ["en", "privacy"],
  ["fr", "privacy"],
];

describe("renderPage", () => {
  it.each(PAIRS)("%s %s is a complete, CSP-safe document", (lang, page) => {
    const html = renderPage(lang, page);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(`<html lang="${lang}">`);
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN + pagePath(lang, page)}">`);
    expect(html.match(/rel="alternate" hreflang="/g)).toHaveLength(3);
    for (const h of ["en", "fr", "x-default"]) expect(html).toContain(`hreflang="${h}"`);
    for (const p of ["og:title", "og:description", "og:image", "og:url", "og:locale"]) {
      expect(html).toContain(`property="${p}"`);
    }
    expect(html).toContain(`content="${lang === "fr" ? "fr_FR" : "en_US"}"`);
    expect(html).toContain('name="twitter:card"');
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) expect(tag).toContain("src=");
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toContain("<style");
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "img" ? [] : sources(full);
    return /\.(ts|css)$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : [];
  });
}

describe("import boundary", () => {
  it("landing/ never imports react or app code beyond catalogue and tokens", () => {
    const files = sources(here);
    expect(files.length).toBeGreaterThan(0);
    const specifier = /(?:from\s+|import\s+|@import\s+(?:url\()?)["']([^"']+)["']/g;
    for (const file of files) {
      const text = readFileSync(file, "utf-8");
      for (const m of text.matchAll(specifier)) {
        const spec = m[1] as string;
        expect(spec, `${file}: ${spec}`).not.toMatch(/react/i);
        if (spec.includes("../src/")) {
          expect(spec, `${file}: ${spec}`).toMatch(/\.\.\/src\/(i18n\/catalogue(?:\.ts)?|tokens\.css)$/);
        }
      }
    }
  });
});
