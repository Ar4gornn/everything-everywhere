import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { landing } from "./messages";
import { ORIGIN, type Page, img, imageProbe, pagePath, renderPage } from "./render";

// img() asks imageProbe whether the screenshot exists. The webp files land in Story 53.5, so
// the tests swap the probe instead of writing fake files into landing/img.
const real = imageProbe.exists;

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

const entries = Object.entries(landing) as [string, { en: string; fr: string }][];
const words = (t: string) => t.trim().split(/\s+/).length;
// Visible text only: drop the head, then every tag.
const visible = (html: string) =>
  html
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'");

describe("messages", () => {
  it("has a non-empty en and fr for every key", () => {
    for (const [key, v] of entries) {
      expect(v.en.trim(), key).not.toBe("");
      expect(v.fr.trim(), key).not.toBe("");
    }
  });

  it("never repeats a sentence-length entry byte for byte across languages", () => {
    for (const [key, v] of entries) {
      if (words(v.en) > 3) expect(v.fr, key).not.toBe(v.en);
    }
  });

  it("has no unused key", () => {
    // Items are written once as `<base>` in render.ts and stored as `<base>.t` / `<base>.d`.
    const source = readFileSync(join(here, "render.ts"), "utf-8");
    const unused = entries
      .map(([key]) => key)
      .filter((key) => {
        const base = key.replace(/\.(t|d)$/, "");
        return !source.includes(`"${key}"`) && !(base !== key && source.includes(`"${base}"`));
      });
    expect(unused).toEqual([]);
  });
});

describe("rendered copy", () => {
  it.each(PAIRS)("%s %s carries no text of the other language", (lang, page) => {
    const other = lang === "en" ? "fr" : "en";
    const text = visible(renderPage(lang, page));
    for (const [key, v] of entries) {
      if (words(v[other]) > 3 && v[other] !== v[lang]) expect(text, key).not.toContain(v[other]);
    }
  });

  it.each(PAIRS)("%s %s makes no claim from the must-not list", (lang, page) => {
    // Push, reminders and the daily digest are absent in prod (epic 53 section 3.2).
    expect(visible(renderPage(lang, page))).not.toMatch(/notif|rappel|reminder/i);
  });

  it.each(PAIRS)("%s %s never says free or names a price", (lang, page) => {
    // EE is not free to use yet and has no public pricing (epic 53 section 3.2).
    expect(visible(renderPage(lang, page))).not.toMatch(/\b(free|gratuit\w*|price|prix)\b/i);
  });

  it.each(["en", "fr"] as const)("%s home has an ordered getting-started list", (lang) => {
    const html = renderPage(lang, "home");
    const section = html.match(/<section[^>]*id="getting-started"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(section).toContain("<ol");
    expect(section.match(/<li>/g)?.length).toBeGreaterThanOrEqual(6);
    expect(section.match(/<li>/g)?.length).toBeLessThanOrEqual(8);
    expect(section).toContain('href="/install"');
    expect(html).toContain('id="tips"');
  });

  it.each(["en", "fr"] as const)("%s home links to sign in and to registering", (lang) => {
    const html = renderPage(lang, "home");
    expect(html).toContain('href="/signin"');
    expect(html).toContain('href="/signin?mode=register"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('<a class="skip" href="#main">');
  });

  it.each(["en", "fr"] as const)("%s privacy page names the cookie and the host", (lang) => {
    const html = renderPage(lang, "privacy");
    expect(html).toContain("ee_app");
    expect(html).toContain("Hetzner");
  });
});

describe("images", () => {
  it("renders nothing when the screenshot is not on disk", () => {
    imageProbe.exists = () => false;
    expect(img("en", "plan", "x")).toBe("");
    expect(renderPage("en", "home")).not.toContain("<img");
  });

  it("gives every image an alt, width and height once the files exist", () => {
    imageProbe.exists = () => true;
    try {
      for (const lang of ["en", "fr"] as const) {
        const tags = renderPage(lang, "home").match(/<img\b[^>]*>/g) ?? [];
        expect(tags).toHaveLength(4);
        for (const tag of tags) {
          expect(tag).toMatch(/\salt="[^"]+"/);
          expect(tag).toMatch(/\swidth="\d+"/);
          expect(tag).toMatch(/\sheight="\d+"/);
        }
        expect(tags.filter((t) => t.includes("fetchpriority"))).toHaveLength(1);
      }
    } finally {
      imageProbe.exists = real;
    }
  });
});
