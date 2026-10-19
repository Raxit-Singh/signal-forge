// Display formatting shared by server and client components. Pure; fixed
// locale so the server and the browser render the same text. Times are shown
// in the viewer's own time zone (sf_tz cookie, see components/time.tsx).

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["week", 7 * 86_400],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelative(date: Date | string, now: Date = new Date()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Math.round((d.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diff);
  if (abs < 60) return "just now";
  for (const [unit, secs] of UNITS) {
    if (abs >= secs) return rtf.format(Math.trunc(diff / secs), unit);
  }
  return "just now";
}

/**
 * Date and time in the viewer's time zone, with the zone named so it is never
 * ambiguous: "Oct 19, 2026, 2:45 PM GMT+5:30". Falls back to UTC for an
 * unknown zone.
 */
export function formatTime(date: Date | string, tz = "UTC", opts: { dateOnly?: boolean } = {}): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  const options: Intl.DateTimeFormatOptions = opts.dateOnly
    ? { month: "short", day: "numeric", year: "numeric" }
    : { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: tz }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(d);
  }
}

export function formatUtc(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function formatCount(n: number): string {
  return Math.abs(n) < 1000 ? String(n) : compact.format(n);
}

/** Opaque keyset cursor for (published_at desc, id desc) pagination. */
export function encodeCursor(publishedAt: string, id: string): string {
  return Buffer.from(`${publishedAt}|${id}`, "utf8").toString("base64url");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeCursor(cursor: string | undefined | null): { publishedAt: string; id: string } | null {
  if (!cursor || cursor.length > 200) return null;
  try {
    const [publishedAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!publishedAt || !id || !UUID.test(id) || Number.isNaN(Date.parse(publishedAt))) return null;
    return { publishedAt: new Date(publishedAt).toISOString(), id };
  } catch {
    return null;
  }
}
