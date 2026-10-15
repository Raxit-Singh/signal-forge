import { createHash } from "node:crypto";

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Converts the small HTML subset used by HN / Stack Exchange into plain text. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return decodeEntities(
    html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<\s*(p|br|li|div|pre|blockquote)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Readable plain text from GitHub-flavoured Markdown (issue bodies).
 * Code blocks become "[code]" so excerpts stay short and readable.
 */
export function markdownToText(md: string | null | undefined): string {
  if (!md) return "";
  return htmlToText(
    md
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<details[\s\S]*?<\/details>/gi, "")
      .replace(/```[\s\S]*?(```|$)/g, "\n[code]\n")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "• ")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/gm, "")
      // Markdown line breaks are not paragraphs; keep htmlToText's paragraph handling for real <p>.
      .replace(/\n/g, "<br>"),
  );
}

/** Trims to `max` characters on a word boundary. */
export function excerpt(text: string | null | undefined, max = 4000): string | null {
  if (!text) return null;
  const t = text.trim();
  if (t.length <= max) return t || null;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${sp > max * 0.8 ? cut.slice(0, sp) : cut}…`;
}

/** Below this many normalized characters, identical text is not evidence of duplication ("+1", "same here"). */
export const MIN_HASH_LENGTH = 60;

/**
 * Hash used for exact-duplicate detection. Case, punctuation and whitespace
 * are ignored; short texts return null so independent short reports are
 * never merged.
 */
export function contentHash(text: string | null | undefined): string | null {
  if (!text) return null;
  const norm = text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (norm.length < MIN_HASH_LENGTH) return null;
  return createHash("sha256").update(norm).digest("hex");
}

const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|igshid$)/i;

/** Normalized form of a shared link, for repost detection. Returns null for non-web URLs. */
export function canonicalLink(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "") || "";
  const qs = u.searchParams.toString();
  return `${host}${path}${qs ? `?${qs}` : ""}`.slice(0, 2048);
}

/** Only https links are stored as source links. */
export function httpsUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((a, v) => a + (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0), 0);
}
