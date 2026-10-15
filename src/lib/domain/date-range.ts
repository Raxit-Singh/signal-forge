// Date-range selection shared by the date picker and (from Milestone 3) the
// analytics queries. All day boundaries are UTC, matching daily_mention_stats.

export type RangeKey = "24h" | "7d" | "30d" | "90d" | "custom";

export const RANGE_PRESETS = [
  { key: "24h", short: "24h", label: "Last 24 hours" },
  { key: "7d", short: "7d", label: "Last 7 days" },
  { key: "30d", short: "30d", label: "Last 30 days" },
  { key: "90d", short: "90d", label: "Last 90 days" },
] as const;

export const DEFAULT_RANGE: RangeKey = "30d";
export const MAX_CUSTOM_DAYS = 730;

export interface ResolvedRange {
  key: RangeKey;
  label: string;
  custom: boolean;
  /** inclusive start */
  from: Date;
  /** exclusive end */
  to: Date;
  /** YYYY-MM-DD (UTC) of first and last day covered */
  fromDate: string;
  toDate: string;
  days: number;
}

const DAY = 86_400_000;

export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseDay(s: string | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || utcDay(d) !== s ? null : d;
}

function preset(key: Exclude<RangeKey, "custom">, now: Date): ResolvedRange {
  const p = RANGE_PRESETS.find((x) => x.key === key)!;
  if (key === "24h") {
    const from = new Date(now.getTime() - DAY);
    return { key, label: p.label, custom: false, from, to: now, fromDate: utcDay(from), toDate: utcDay(now), days: 1 };
  }
  const days = Number(key.replace("d", ""));
  const from = new Date(startOfUtcDay(now).getTime() - (days - 1) * DAY);
  return { key, label: p.label, custom: false, from, to: now, fromDate: utcDay(from), toDate: utcDay(now), days };
}

/** Resolves ?range=&from=&to= into a concrete window. Invalid input falls back to the default. */
export function parseRange(params: Record<string, string | undefined>, now: Date): ResolvedRange {
  const key = params.range as RangeKey | undefined;
  if (key === "custom") {
    const from = parseDay(params.from);
    let toDay = parseDay(params.to);
    const today = startOfUtcDay(now);
    if (from && toDay) {
      if (toDay > today) toDay = today;
      if (from <= toDay) {
        const days = Math.round((toDay.getTime() - from.getTime()) / DAY) + 1;
        if (days <= MAX_CUSTOM_DAYS) {
          const end = new Date(toDay.getTime() + DAY);
          const fromDate = utcDay(from);
          const toDate = utcDay(toDay);
          return {
            key: "custom",
            label: fromDate === toDate ? fromDate : `${fromDate} → ${toDate}`,
            custom: true,
            from,
            to: end > now ? now : end,
            fromDate,
            toDate,
            days,
          };
        }
      }
    }
    return preset(DEFAULT_RANGE as Exclude<RangeKey, "custom">, now);
  }
  if (key === "24h" || key === "7d" || key === "30d" || key === "90d") return preset(key, now);
  return preset(DEFAULT_RANGE as Exclude<RangeKey, "custom">, now);
}

/** The equal-length window immediately before `r`, used for period-over-period comparisons. */
export function previousWindow(r: ResolvedRange): { from: Date; to: Date } {
  const len = r.to.getTime() - r.from.getTime();
  return { from: new Date(r.from.getTime() - len), to: new Date(r.from.getTime()) };
}
