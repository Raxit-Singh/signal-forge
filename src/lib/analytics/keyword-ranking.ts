// Keyword-first monitoring rankings (pure).
//
// Rank = descending count of relevant mentions in the selected period. Nothing
// else changes a rank: growth, engagement, momentum and AI are shown next to
// it, never mixed into it. Ties are broken by name, then id, so the order is
// stable between page loads.
//
// Counting: a mention that matched several keywords counts once for each of
// those keywords (per-keyword statistics), but only once in a platform's or
// the product's total.
//
// Unscanned platforms are never ranked as if they had zero mentions: they have
// no rank and are listed after the ranked ones.

export type CoverageStatus = "not_scanned" | "learning" | "partial" | "monitored";

export const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  not_scanned: "Not scanned yet",
  learning: "Learning",
  partial: "Partial coverage",
  monitored: "Monitored",
};

export interface Rankable {
  id: string;
  name: string;
  /** null = not scanned (unknown), which is different from 0 found. */
  mentions: number | null;
}

/** Sorts by mentions (desc), then name, then id; unscanned items last, unranked. */
export function rankByMentions<T extends Rankable>(items: T[]): Array<T & { rank: number | null }> {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en");
  const scanned = items.filter((i) => i.mentions !== null).sort((a, b) => b.mentions! - a.mentions! || byName(a, b));
  const unscanned = items.filter((i) => i.mentions === null).sort(byName);
  return [...scanned.map((i, n) => ({ ...i, rank: n + 1 })), ...unscanned.map((i) => ({ ...i, rank: null }))];
}

/**
 * Change vs the previous period of the same length, in percent. Null when it
 * can't be stated honestly: the previous period wasn't (sufficiently) monitored,
 * or it had no mentions to compare against.
 */
export function growthPct(current: number, previous: number, previousObserved: boolean): number | null {
  if (!previousObserved || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export interface PlatformInput {
  id: string;
  name: string;
  status: CoverageStatus;
  /** Keywords (as stored) this platform can search; others aren't listed for it. */
  searchable: Set<string>;
  /** Whether the previous period was monitored well enough to compare against. */
  previousObserved: boolean;
}

export interface CountRow { keyword: string; platform: string; mentions: number }

export interface KeywordPlatformStat {
  id: string;
  name: string;
  status: CoverageStatus;
  mentions: number | null;
  rank: number | null;
  sharePct: number | null;
  growthPct: number | null;
}

export interface KeywordPerformance {
  term: string;
  kind: string;
  paused: boolean;
  rank: number | null;
  /** Relevant mentions matching this keyword, all platforms (null = nowhere scanned yet). */
  mentions: number | null;
  growthPct: number | null;
  best: { id: string; name: string; mentions: number } | null;
  platforms: KeywordPlatformStat[];
}

const key = (k: string) => k.trim().toLowerCase();

/** Per keyword: total, best platform, distribution and growth; keywords ranked by total. */
export function keywordPerformance(input: {
  keywords: Array<{ term: string; kind: string; paused: boolean }>;
  platforms: PlatformInput[];
  current: CountRow[];
  previous: CountRow[];
}): KeywordPerformance[] {
  const index = (rows: CountRow[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(`${key(r.keyword)}\u0000${r.platform}`, (m.get(`${key(r.keyword)}\u0000${r.platform}`) ?? 0) + r.mentions);
    return m;
  };
  const cur = index(input.current);
  const prev = index(input.previous);

  const rows = input.keywords.map((k) => {
    const on = k.paused ? [] : input.platforms.filter((p) => p.searchable.has(key(k.term)));
    const stats = on.map((p) => {
      const n = cur.get(`${key(k.term)}\u0000${p.id}`) ?? 0;
      const before = prev.get(`${key(k.term)}\u0000${p.id}`) ?? 0;
      return {
        id: p.id, name: p.name, status: p.status,
        mentions: p.status === "not_scanned" ? null : n,
        growthPct: p.status === "not_scanned" ? null : growthPct(n, before, p.previousObserved),
        previous: before, previousObserved: p.previousObserved,
      };
    });
    const ranked = rankByMentions(stats);
    const scanned = ranked.filter((s) => s.mentions !== null);
    const total = scanned.length ? scanned.reduce((t, s) => t + s.mentions!, 0) : null;
    const comparable = scanned.filter((s) => s.previousObserved);
    const prevTotal = comparable.reduce((t, s) => t + s.previous, 0);
    const curComparable = comparable.reduce((t, s) => t + s.mentions!, 0);
    const top = ranked[0];
    return {
      id: k.term, name: k.term, term: k.term, kind: k.kind, paused: k.paused,
      mentions: k.paused ? null : total,
      growthPct: comparable.length ? growthPct(curComparable, prevTotal, true) : null,
      best: top && top.mentions ? { id: top.id, name: top.name, mentions: top.mentions } : null,
      platforms: ranked.map(({ previous: _p, previousObserved: _o, ...s }) => ({
        ...s, sharePct: total && s.mentions !== null ? Math.round((s.mentions / total) * 100) : null,
      })),
    };
  });
  return rankByMentions(rows).map(({ id: _id, name: _name, ...r }) => r);
}

export interface PlatformPerformance {
  id: string;
  name: string;
  status: CoverageStatus;
  rank: number | null;
  mentions: number | null;
  sharePct: number | null;
  growthPct: number | null;
}

/** Overall platform ranking from each platform's unique relevant mentions. */
export function platformPerformance(input: {
  platforms: Array<{ id: string; name: string; status: CoverageStatus; previousObserved: boolean }>;
  current: Record<string, number>;
  previous: Record<string, number>;
}): PlatformPerformance[] {
  const rows = input.platforms.map((p) => {
    const n = input.current[p.id] ?? 0;
    return {
      id: p.id, name: p.name, status: p.status,
      mentions: p.status === "not_scanned" ? null : n,
      growthPct: p.status === "not_scanned" ? null : growthPct(n, input.previous[p.id] ?? 0, p.previousObserved),
    };
  });
  const total = rows.reduce((t, r) => t + (r.mentions ?? 0), 0);
  return rankByMentions(rows).map((r) => ({ ...r, sharePct: total > 0 && r.mentions !== null ? Math.round((r.mentions / total) * 100) : null }));
}

/** Customer-facing coverage status of a platform from what monitoring has measured. */
export function coverageStatus(p: { lastScanAt: string | null; learning: boolean; partial: boolean }): CoverageStatus {
  if (!p.lastScanAt) return "not_scanned";
  if (p.partial) return "partial";
  if (p.learning) return "learning";
  return "monitored";
}
