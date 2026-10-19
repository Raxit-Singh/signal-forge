// Pure URL helpers. No framework imports: unit-tested with `node --test`.

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f]{2}:.*)$/i;

/** Normalizes a user-entered website. Adds https:// when the scheme is missing. */
export function normalizeWebsiteUrl(input: string): Result<{ url: string; domain: string }> {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Enter a URL." };
  if (raw.length > 2048) return { ok: false, error: "URL is too long." };

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Only http and https URLs are supported." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "URLs with embedded credentials are not allowed." };
  }
  const host = parsed.hostname.toLowerCase();
  if (!host.includes(".") || PRIVATE_HOST.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return { ok: false, error: "Use a public domain name." };
  }
  parsed.hash = "";
  const url = parsed.toString().replace(/\/$/, "");
  return { ok: true, value: { url, domain: registrableDomain(host) } };
}

/** Strips "www." and returns the host. (Public-suffix accuracy is not needed for keyword use.) */
export function registrableDomain(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/** Accepts "owner/repo", "github.com/owner/repo", or a full https URL (optionally .git). */
export function parseGithubRepo(input: string): Result<{ owner: string; repo: string; fullName: string }> {
  let s = input.trim();
  if (!s) return { ok: false, error: "Enter a repository." };
  s = s.replace(/^git@github\.com:/i, "");
  s = s.replace(/^https?:\/\//i, "").replace(/^(www\.)?github\.com\//i, "");
  s = s.replace(/\.git$/i, "").replace(/\/+$/, "");
  const parts = s.split("/");
  if (parts.length !== 2) return { ok: false, error: "Use the form owner/repository." };
  const [owner, repo] = parts as [string, string];
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) || owner.endsWith("-")) {
    return { ok: false, error: "Invalid GitHub owner name." };
  }
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo === "." || repo === "..") {
    return { ok: false, error: "Invalid repository name." };
  }
  return { ok: true, value: { owner, repo, fullName: `${owner}/${repo}` } };
}

/** App Store listing, e.g. https://apps.apple.com/us/app/name/id123456789 */
/**
 * Store links are often pasted together with the app's title (the share sheet
 * copies "https://apps.apple.com/… Erly: Wake Up Early"). Keeps just the link,
 * and adds https:// when the scheme was left off.
 */
function pastedStoreLink(input: string, host: string): string {
  const tokens = input.trim().split(/\s+/);
  const link = tokens.find((t) => /^https?:\/\//i.test(t)) ?? tokens.find((t) => t.toLowerCase().startsWith(host)) ?? input.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(link) ? link : `https://${link}`;
}

export function parseAppStoreUrl(input: string): Result<{ url: string; appId: string }> {
  let parsed: URL;
  try {
    parsed = new URL(pastedStoreLink(input, "apps.apple.com"));
  } catch {
    return { ok: false, error: "Enter a full App Store URL." };
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "apps.apple.com") {
    return { ok: false, error: "App Store URLs start with https://apps.apple.com/" };
  }
  const match = parsed.pathname.match(/\/id(\d{5,12})(?!\d)/);
  if (!match?.[1]) return { ok: false, error: "Couldn't find the app id (…/id123456789) in that URL." };
  parsed.search = "";
  parsed.hash = "";
  return { ok: true, value: { url: parsed.toString(), appId: match[1] } };
}

/** Google Play listing, e.g. https://play.google.com/store/apps/details?id=com.example.app */
export function parsePlayStoreUrl(input: string): Result<{ url: string; packageName: string }> {
  let parsed: URL;
  try {
    parsed = new URL(pastedStoreLink(input, "play.google.com"));
  } catch {
    return { ok: false, error: "Enter a full Google Play URL." };
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "play.google.com") {
    return { ok: false, error: "Google Play URLs start with https://play.google.com/" };
  }
  const id = parsed.searchParams.get("id") ?? "";
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(id) || id.length > 150) {
    return { ok: false, error: "Couldn't find a valid package name (?id=com.example.app)." };
  }
  return {
    ok: true,
    value: { url: `https://play.google.com/store/apps/details?id=${id}`, packageName: id },
  };
}

/** Only allow same-origin relative redirect targets (prevents open redirects). */
export function safeRedirectPath(input: string | null | undefined, fallback = "/overview"): string {
  if (!input) return fallback;
  if (!input.startsWith("/") || input.startsWith("//") || input.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(input)) return fallback;
  return input;
}
