// Competitor comparison (pure). A product and its competitors are compared only
// on sources monitored for all of them, and only over the period all of them
// were tracked: anything else would compare collection effort, not attention.

/**
 * Fixed color per position: the product is always entity-1 and competitors keep theirs
 * in the order they were added (plans allow at most 5), so colors never reshuffle.
 */
export const ENTITY_COLORS = ["var(--entity-1)", "var(--entity-2)", "var(--entity-3)", "var(--entity-4)", "var(--entity-5)", "var(--entity-6)"];

export interface Entity {
  id: string;
  name: string;
  isProduct: boolean;
  /** When collection for this entity started (competitors: when they were added). */
  trackedSince: Date;
  /** Sources with an enabled search for this entity. */
  sources: string[];
}

export interface ComparisonWindow {
  from: Date;
  to: Date;
  /** True when the requested range started before every entity was tracked. */
  clamped: boolean;
  /** No overlap at all (e.g. a competitor added after the range ended). */
  empty: boolean;
}

/** The part of the requested range during which every entity was being tracked. */
export function comparisonWindow(rangeFrom: Date, rangeTo: Date, entities: Entity[]): ComparisonWindow {
  const latestStart = entities.reduce((t, e) => Math.max(t, e.trackedSince.getTime()), rangeFrom.getTime());
  const from = new Date(Math.min(latestStart, rangeTo.getTime()));
  return { from, to: rangeTo, clamped: latestStart > rangeFrom.getTime(), empty: from.getTime() >= rangeTo.getTime() };
}

/** Sources monitored for every entity, and the ones left out (with who lacks them). */
export function comparableSources(entities: Entity[]): { common: string[]; excluded: Array<{ source: string; missingFor: string[] }> } {
  if (!entities.length) return { common: [], excluded: [] };
  const all = [...new Set(entities.flatMap((e) => e.sources))].sort();
  const common: string[] = [];
  const excluded: Array<{ source: string; missingFor: string[] }> = [];
  for (const s of all) {
    const missingFor = entities.filter((e) => !e.sources.includes(s)).map((e) => e.name);
    if (missingFor.length) excluded.push({ source: s, missingFor });
    else common.push(s);
  }
  return { common, excluded };
}

export interface VoiceRow { id: string; name: string; isProduct: boolean; mentions: number; share: number | null }

/** Share of voice: each entity's relevant mentions as a share of all of them (null when nobody has any). */
export function shareOfVoice(counts: Array<{ id: string; name: string; isProduct: boolean; mentions: number }>): VoiceRow[] {
  const total = counts.reduce((s, c) => s + Math.max(0, c.mentions), 0);
  return counts.map((c) => ({ ...c, mentions: Math.max(0, c.mentions), share: total > 0 ? Math.max(0, c.mentions) / total : null }));
}

export interface SentimentCounts { classified: number; unclassified: number; positive: number; negative: number; neutral: number; mixed: number; uncertain: number }

/** Below this many classified mentions a sentiment split is shown as counts only, not compared. */
export const MIN_CLASSIFIED_FOR_SENTIMENT = 20;

export interface SentimentSummary extends SentimentCounts {
  /** (positive − negative) / classified, in [−1, 1]; null when too few are classified to say. */
  net: number | null;
  /** Share of collected mentions that have been classified. */
  coverage: number | null;
  enough: boolean;
}

export function summarizeSentiment(days: SentimentCounts[]): SentimentSummary {
  const sum: SentimentCounts = { classified: 0, unclassified: 0, positive: 0, negative: 0, neutral: 0, mixed: 0, uncertain: 0 };
  for (const d of days) for (const k of Object.keys(sum) as Array<keyof SentimentCounts>) sum[k] += d[k] ?? 0;
  const enough = sum.classified >= MIN_CLASSIFIED_FOR_SENTIMENT;
  const all = sum.classified + sum.unclassified;
  return {
    ...sum,
    net: enough ? (sum.positive - sum.negative) / sum.classified : null,
    coverage: all > 0 ? sum.classified / all : null,
    enough,
  };
}

/** Daily relevant mentions per entity on one shared day axis (missing days are 0). */
export function alignDaily(from: Date, to: Date, series: Array<{ id: string; days: Array<{ day: string; mentions: number }> }>, tzDay: (d: Date) => string): Array<Record<string, number | string>> {
  const days: string[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += 86_400_000) {
    const d = tzDay(new Date(t));
    if (days[days.length - 1] !== d) days.push(d);
  }
  const last = tzDay(new Date(to.getTime() - 1));
  if (days[days.length - 1] !== last) days.push(last);
  const byEntity = new Map(series.map((s) => [s.id, new Map(s.days.map((d) => [d.day, d.mentions]))]));
  return days.map((day) => {
    const row: Record<string, number | string> = { day };
    for (const s of series) row[s.id] = byEntity.get(s.id)?.get(day) ?? 0;
    return row;
  });
}
