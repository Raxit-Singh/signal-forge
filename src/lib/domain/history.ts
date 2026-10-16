// Historical search preference (pure; shared by the onboarding form and the server).
//
// The customer chooses how far back SignalForge searches when a product is
// added. The range ends when the search starts; ongoing monitoring covers
// everything after. The plan's history window (Free 30 days, Pro 365, Scale 730)
// bounds how far back a search may start; sources that can't reach that far are
// reported per platform, never filled in.

export type HistoryMode = "launch" | "7d" | "30d" | "90d" | "180d" | "365d" | "custom";

export interface HistoryOption {
  mode: HistoryMode;
  label: string;
  days?: number;
}

export const HISTORY_OPTIONS: HistoryOption[] = [
  { mode: "launch", label: "Since product launch" },
  { mode: "7d", label: "Last 7 days", days: 7 },
  { mode: "30d", label: "Last 30 days", days: 30 },
  { mode: "90d", label: "Last 90 days", days: 90 },
  { mode: "180d", label: "Last 6 months", days: 180 },
  { mode: "365d", label: "Last 1 year", days: 365 },
  { mode: "custom", label: "Custom date" },
];

export const DEFAULT_HISTORY_MODE: HistoryMode = "30d";
export const RECOMMENDED_DAYS = 30;
const DAY = 86_400_000;

export function isHistoryMode(v: unknown): v is HistoryMode {
  return typeof v === "string" && HISTORY_OPTIONS.some((o) => o.mode === v);
}

export type HistoryRange =
  | { ok: true; mode: HistoryMode; start: Date; end: Date; days: number }
  | { ok: false; field: "mode" | "launchDate" | "customStart"; error: string };

/** Parses YYYY-MM-DD as the start of that UTC day; null if malformed or not a real date. */
export function parseDay(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

export const formatDay = (d: Date) => d.toISOString().slice(0, 10);

/** Earliest start the plan allows (UTC midnight, inclusive). */
export function earliestStart(now: Date, planHistoryDays: number): Date {
  return new Date(Math.floor((now.getTime() - planHistoryDays * DAY) / DAY) * DAY + DAY);
}

export function resolveHistoryRange(i: {
  mode: string | null | undefined;
  launchDate?: string | null;
  customStart?: string | null;
  now: Date;
  planHistoryDays: number;
  planName?: string;
}): HistoryRange {
  if (!isHistoryMode(i.mode)) return { ok: false, field: "mode", error: "Choose how far back to search." };
  const end = i.now;
  const floor = earliestStart(i.now, i.planHistoryDays);
  const planLimit = `Your ${i.planName ? `${i.planName} ` : ""}plan searches back up to ${i.planHistoryDays} days (from ${formatDay(floor)}).`;
  let start: Date;
  if (i.mode === "launch" || i.mode === "custom") {
    const field = i.mode === "launch" ? "launchDate" : "customStart";
    const raw = i.mode === "launch" ? i.launchDate : i.customStart;
    const d = parseDay(raw);
    if (!d) return { ok: false, field, error: i.mode === "launch" ? "Enter your product's launch date (YYYY-MM-DD)." : "Enter a start date (YYYY-MM-DD)." };
    if (d.getTime() >= end.getTime()) return { ok: false, field, error: "The date must be in the past." };
    if (d < floor) return { ok: false, field, error: `${planLimit} Choose ${formatDay(floor)} or later.` };
    start = d;
  } else {
    const days = HISTORY_OPTIONS.find((o) => o.mode === i.mode)!.days!;
    if (days > i.planHistoryDays) return { ok: false, field: "mode", error: planLimit };
    start = new Date(end.getTime() - days * DAY);
  }
  return { ok: true, mode: i.mode, start, end, days: Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY)) };
}

export interface HistoryWarning {
  level: "info" | "warning";
  message: string;
}

/**
 * Warnings before a historical search. Volume estimates are given only when they
 * come from measured data (mentions this product already collected); otherwise a
 * general risk statement — never an invented number.
 */
export function historyWarnings(i: {
  days: number;
  broadKeywords: string[];
  /** Relevant mentions per day measured for these keywords, with the days it was measured over. */
  measured?: { perDay: number; overDays: number } | null;
  allowance: number;
  allowanceRemaining: number;
  planName: string;
}): HistoryWarning[] {
  const out: HistoryWarning[] = [];
  const fmt = (n: number) => n.toLocaleString("en-US");
  if (i.measured && i.measured.overDays >= 3) {
    const est = Math.round(i.measured.perDay * i.days);
    if (est >= i.allowanceRemaining) {
      out.push({
        level: "warning",
        message: `At the rate measured over the last ${i.measured.overDays} days (about ${fmt(Math.round(i.measured.perDay))} relevant mentions a day), ${i.days} days of history could be about ${fmt(est)} mentions — more than the ${fmt(i.allowanceRemaining)} left in this billing period. A shorter period, such as ${RECOMMENDED_DAYS} days, leaves room for ongoing monitoring.`,
      });
    }
  } else if (i.broadKeywords.length > 0) {
    out.push({
      level: "warning",
      message: `${quoteList(i.broadKeywords)} ${i.broadKeywords.length === 1 ? "is a broad keyword" : "are broad keywords"}: they may produce more than ${fmt(i.allowance)} mentions. A large historical search could use your ${i.planName} plan's monthly allowance before ongoing monitoring begins. We recommend starting with the last ${RECOMMENDED_DAYS} days.`,
    });
  } else if (i.days > RECOMMENDED_DAYS) {
    out.push({
      level: "info",
      message: `How many mentions ${i.days} days will produce can't be known in advance. Historical and new mentions use the same allowance (${fmt(i.allowanceRemaining)} left this period); the search pauses — keeping what it found — if the allowance runs out.`,
    });
  }
  return out;
}

function quoteList(xs: string[]): string {
  const q = xs.slice(0, 4).map((x) => `“${x}”`);
  if (xs.length > 4) q.push(`${xs.length - 4} more`);
  return q.length <= 1 ? q.join("") : `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}`;
}
