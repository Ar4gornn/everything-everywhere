// Captures the landing-page screenshots and OG images with headless Chrome over CDP.
// No npm dependencies: Node 22's global WebSocket and fetch only.
//
// Env: EE_ACCESS_EN/EE_REFRESH_EN and EE_ACCESS_FR/EE_REFRESH_FR (one fixture account per
//      language, from seed_demo.py; never on argv),
//      BASE (default http://localhost:8026), CHROME (default Windows Chrome path),
//      ONLY (optional, "shots" or "og").
// Writes frontend/landing/img/<lang>-<shot>.webp and frontend/public/og-<lang>.png.
// Only fixture data may be on screen (demo@example.com, seeded numbers).

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const IMG_DIR = join(ROOT, "frontend/landing/img");
const PUBLIC_DIR = join(ROOT, "frontend/public");
const BASE = process.env.BASE ?? "http://localhost:8026";
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const TOKENS = {
  en: [process.env.EE_ACCESS_EN, process.env.EE_REFRESH_EN],
  fr: [process.env.EE_ACCESS_FR, process.env.EE_REFRESH_FR],
};
const ONLY = process.env.ONLY ?? "";
const KB = 1024;

const LANGS = (process.env.LANGS ?? "en,fr").split(",");
// route, and an optional card to scroll to the top of (a real page, just scrolled).
// The floating action buttons are hidden: they sit on top of the numbers in a still image.
const SHOTS = {
  dashboard: { route: "/", scroll: '[data-tour="budget-progress"]' },
  // The Savings card has no tour marker: match its title text instead.
  plan: { route: "/plan", scroll: ".card", title: /^(Savings|\u00c9pargne)\b/i },
  stock: { route: "/inventory" },
  habits: { route: "/habits" },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
    s.on("error", rej);
  });
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: ok, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}`));
        else ok(msg.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function connect(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const ws = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise((ok, bad) => {
        ws.addEventListener("open", ok);
        ws.addEventListener("error", bad);
      });
      return new Cdp(ws);
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Chrome did not expose its debugging port");
}

async function main() {
  for (const l of LANGS) if (!TOKENS[l]?.[0] || !TOKENS[l]?.[1]) throw new Error(`tokens for ${l} not set`);
  mkdirSync(IMG_DIR, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "ee-shots-"));
  const port = await freePort();
  const chrome = spawn(
    CHROME,
    ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
      "--no-first-run", "--hide-scrollbars", "about:blank"],
    { stdio: "ignore" },
  );
  try {
    const cdp = await connect(port);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m, p) => cdp.send(m, p, sessionId);
    await s("Page.enable");
    await s("Runtime.enable");

    const evaluate = async (expression) => {
      const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      return r.result.value;
    };
    const go = async (url) => {
      await s("Page.navigate", { url });
      await sleep(600);
      for (let i = 0; i < 50; i++) {
        if ((await evaluate("document.readyState")) === "complete") return;
        await sleep(200);
      }
    };
    const shoot = async (format, quality) => {
      const r = await s("Page.captureScreenshot", { format, ...(quality ? { quality } : {}) });
      return Buffer.from(r.data, "base64");
    };
    const size = (path) => `${(statSync(path).size / KB).toFixed(0)} KB`;

    if (ONLY !== "og") {
      await s("Emulation.setDeviceMetricsOverride",
        { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await s("Emulation.setTouchEmulationEnabled", { enabled: true });

      for (const lang of LANGS) {
        await s("Emulation.setLocaleOverride", { locale: lang === "fr" ? "fr-FR" : "en-US" });
        const [ACCESS, REFRESH] = TOKENS[lang];
        const res = await fetch(`${BASE}/api/auth/me/language`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ACCESS}` },
          body: JSON.stringify({ language: lang }),
        });
        if (!res.ok) throw new Error(`language ${lang}: ${res.status}`);

        // Same-origin page just to reach this origin's localStorage.
        await go(`${BASE}/health`);
        await evaluate(`(() => {
          localStorage.clear();
          localStorage.setItem("everything-everywhere.token", ${JSON.stringify(ACCESS)});
          localStorage.setItem("everything-everywhere.refresh", ${JSON.stringify(REFRESH)});
          localStorage.setItem("everything-everywhere.theme", "light");
          localStorage.setItem("everything-everywhere.language", ${JSON.stringify(lang)});
          localStorage.setItem("everything-everywhere.install.consent", "no");
          localStorage.setItem("everything-everywhere.install.welcomed", "1");
          localStorage.setItem("everything-everywhere.install.dismissedAt", String(Date.now()));
        })()`);

        for (const [shot, { route, scroll, title }] of Object.entries(SHOTS)) {
          await go(`${BASE}${route}`);
          let ready = false;
          for (let i = 0; i < 60 && !ready; i++) {
            ready = await evaluate(`(() => {
              const main = document.querySelector("main");
              if (!main) return false;
              if (document.querySelector('[aria-busy="true"]')) return false;
              if (/Loading|Chargement/.test(main.innerText)) return false;
              return main.querySelectorAll(".card, table, li").length >= 2;
            })()`);
            if (!ready) await sleep(250);
          }
          if (!ready) throw new Error(`${lang}/${shot}: main content never appeared`);
          if (scroll) {
            const found = await evaluate(`(() => {
              const re = ${title ? title.toString() : "null"};
              const all = [...document.querySelectorAll(${JSON.stringify(scroll)})];
              const el = re ? all.find((c) => re.test(c.innerText.trim())) : all[0];
              if (!el) return false;
              el.scrollIntoView({ block: "start" });
              window.scrollBy(0, -16);
              return true;
            })()`);
            if (!found) throw new Error(`${lang}/${shot}: ${scroll} not found`);
          }
          await evaluate(`(() => {
            const st = document.createElement("style");
            st.textContent = ".fab, .fab-note { display: none !important; }";
            document.head.appendChild(st);
            return true;
          })()`);
          await sleep(600);
          const out = join(IMG_DIR, `${lang}-${shot}.webp`);
          let q = 80;
          let buf = await shoot("webp", q);
          while (buf.length > 120 * KB && q > 30) buf = await shoot("webp", (q -= 10));
          writeFileSync(out, buf);
          console.log(`${lang}-${shot}.webp q${q} ${size(out)}`);
        }
      }
      await s("Emulation.setTouchEmulationEnabled", { enabled: false });
    }

    if (ONLY !== "shots") {
      await s("Emulation.setDeviceMetricsOverride",
        { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
      for (const lang of LANGS) {
        const url = pathToFileURL(join(HERE, "og.html")).href + `?lang=${lang}`;
        await go(url);
        await evaluate("document.fonts.ready.then(() => true)");
        await sleep(400);
        const out = join(PUBLIC_DIR, `og-${lang}.png`);
        writeFileSync(out, await shoot("png"));
        console.log(`og-${lang}.png ${size(out)}`);
      }
    }
    cdp.ws.close();
  } finally {
    chrome.kill();
    await sleep(800);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      console.warn(`could not remove ${profile}`);
    }
  }
}

main().then(() => process.exit(0), (err) => {
  console.error(err.message);
  process.exit(1);
});
