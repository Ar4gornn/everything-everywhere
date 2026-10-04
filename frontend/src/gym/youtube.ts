/** Epic 54.5: pull a YouTube video id (and start offset) out of a link, or null. */

const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

function parse(url: string): URL | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  return u;
}

export function youtubeId(url: string): string | null {
  const u = parse(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  let candidate: string | null = null;
  if (host === "youtu.be") {
    candidate = u.pathname.split("/")[1] ?? null;
  } else if (HOSTS.has(host)) {
    const parts = u.pathname.split("/").filter(Boolean);
    const embedOnly = host.endsWith("youtube-nocookie.com");
    if (parts.length === 1 && parts[0] === "watch" && !embedOnly) {
      candidate = u.searchParams.get("v");
    } else if (parts.length === 2) {
      if (parts[0] === "embed" || (!embedOnly && (parts[0] === "shorts" || parts[0] === "live"))) {
        candidate = parts[1] ?? null;
      }
    }
  }
  return candidate !== null && ID.test(candidate) ? candidate : null;
}

/** `t=` / `start=`: plain seconds ("90", "90s") or "1h2m3s" forms. */
export function youtubeStart(url: string): number | null {
  const u = parse(url);
  if (!u) return null;
  const raw = u.searchParams.get("t") ?? u.searchParams.get("start");
  if (!raw) return null;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw.trim());
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;
  const secs = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return secs > 0 && secs < 86400 ? secs : null;
}
