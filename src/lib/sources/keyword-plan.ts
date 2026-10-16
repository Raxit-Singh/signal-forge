// What each platform actually searches for a product's keywords (pure).
//
// One planner for the worker (query sync), the Smart Monitoring page and the
// keyword audit script. Every configured keyword is monitored on every platform
// that can search it:
//   * OR-capable platforms combine keywords (split when term/length limits require)
//   * keywords found by a broader search ("FocusFlow pricing" ⊃ "FocusFlow") or
//     identical to another are covered by that search
//   * when a platform has a search budget per check (paid platforms without OR,
//     quota-limited sources) and needs more searches than that, the top-priority
//     search runs every check and the others take turns in fixed time slots
//     (fair rotation). Each search keeps its own checkpoint, so a turn re-searches
//     everything since its last check. No keyword waits longer than the coverage
//     guarantee (7 days), even if that exceeds the budget.
// Only keywords a platform genuinely can't search are left out, with the reason.

import { devTag } from "./official.ts";
import { planQueries, type OptimizerKeyword, type QueryGroup, type SkippedKeyword } from "./query-optimizer.ts";
import { isLegacySource, streamsOf } from "./registry.ts";
import type { PublicSourceId, SourceAdapter } from "./types.ts";

/** Every searchable keyword is searched at least this often (minutes): 7 days. */
export const KEYWORD_COVERAGE_GUARANTEE_MINUTES = 7 * 1440;
/** Stack Exchange without an API key shares ~300 requests/day per server: few searches per check. */
export const STACKEXCHANGE_ANON_BUDGET = 3;

/** Turn-taking position of a search that doesn't run every check. Stored in monitoring_queries.params. */
export interface Rotation {
  /** 0-based position among the rotating searches of this platform stream. */
  position: number;
  /** How many searches rotate. */
  rotating: number;
  /** Rotating searches allowed per check. */
  slots: number;
}

export interface PlannedGroup extends QueryGroup {
  rotation: Rotation | null;
}

export interface StreamKeywordPlan {
  stream: string;
  label: string;
  /** Reviews of the product's own page: no keyword query. */
  productOnly: boolean;
  /** Searches allowed per check (null = no limit). */
  budget: number | null;
  groups: PlannedGroup[];
  skipped: SkippedKeyword[];
}

export type KeywordStatus = "every_check" | "rotating" | "covered" | "duplicate" | "unsupported" | "not_applicable";

export interface KeywordCoverage {
  term: string;
  status: KeywordStatus;
  detail: string;
  /** Slowest rotation among the streams that search it (null = every check). */
  rotation: Rotation | null;
  /** Covered / duplicate: the keyword whose search finds it. */
  via?: string;
}

export interface PlatformKeywordPlan {
  platform: PublicSourceId;
  /** OR operator the platform's keyword search accepts, or false. */
  booleanOr: string | false;
  streams: StreamKeywordPlan[];
  /** Keywords searched by at least one stream (every check or in rotation). */
  searched: string[];
  /** Keywords this platform can't search, with the reason. */
  skipped: SkippedKeyword[];
  /** Searches stored per platform (all streams). */
  searches: number;
  /** Average searches run per check (rotating searches count 1/turns). */
  searchesPerCheck: number;
  /** Keywords searched in a query of their own (not combined with others). */
  separate: string[];
  productOnly: boolean;
  keywords: KeywordCoverage[];
}

export interface BudgetOptions {
  /** Plan's separate searches per check on paid platforms without OR. */
  planMaxSearches: number;
  /** Stack Exchange key configured (much higher quota). */
  stackExchangeKey?: boolean;
}

/** Searches per check a platform may run (null = no limit). */
export function searchBudget(platform: PublicSourceId, adapter: SourceAdapter, opts: BudgetOptions): number | null {
  if (platform === "stackexchange") return opts.stackExchangeKey ? null : STACKEXCHANGE_ANON_BUDGET;
  const caps = streamsOf(adapter).find((s) => s.queryMode === "keywords")?.capabilities;
  if (adapter.paid && caps && !caps.booleanOr) return Math.max(1, opts.planMaxSearches);
  return null;
}

/** Turns a rotating search waits between checks at a platform interval (bounded by the guarantee). */
export function rotationTurns(r: Rotation, intervalMinutes: number): number {
  const ideal = Math.ceil(r.rotating / Math.max(1, r.slots));
  const cap = Math.max(1, Math.floor(KEYWORD_COVERAGE_GUARANTEE_MINUTES / Math.max(1, intervalMinutes)));
  return Math.max(1, Math.min(ideal, cap));
}

/** Effective refresh interval of a search: the platform interval × its rotation turns. */
export function keywordIntervalMinutes(platformIntervalMinutes: number, rotation: Rotation | null): number {
  return rotation ? platformIntervalMinutes * rotationTurns(rotation, platformIntervalMinutes) : platformIntervalMinutes;
}

/**
 * Next run of a rotating search: time is cut into slots of one platform interval;
 * a search runs in the slots where (slot number mod turns) equals its phase, so each
 * slot runs at most `slots` rotating searches and every search gets the same share.
 */
export function rotationNextRun(now: Date, platformIntervalMinutes: number, rotation: Rotation): Date {
  const slotMs = platformIntervalMinutes * 60_000;
  const turns = rotationTurns(rotation, platformIntervalMinutes);
  const phase = rotation.position % turns;
  let slot = Math.floor(now.getTime() / slotMs) + 1;
  while (slot % turns !== phase) slot++;
  return new Date(slot * slotMs);
}

function rotate(groups: QueryGroup[], budget: number | null): PlannedGroup[] {
  if (budget === null || groups.length <= budget) return groups.map((g) => ({ ...g, rotation: null }));
  // The highest-priority search (exact product name first) keeps every check when the budget allows two or more.
  const fixed = budget >= 2 ? 1 : 0;
  const rotating = groups.length - fixed;
  const slots = budget - fixed;
  return groups.map((g, i) => ({ ...g, rotation: i < fixed ? null : { position: i - fixed, rotating, slots } }));
}

const slower = (a: Rotation | null, b: Rotation | null) => (!a ? b : !b ? a : a.rotating / a.slots >= b.rotating / b.slots ? a : b);

/** Query groups per stream for one platform, plus per-keyword coverage. */
export function planPlatformKeywords(
  platform: PublicSourceId,
  adapter: SourceAdapter,
  keywords: OptimizerKeyword[],
  opts: BudgetOptions,
): PlatformKeywordPlan {
  const budget = searchBudget(platform, adapter, opts);
  const streams = streamsOf(adapter).map((s): StreamKeywordPlan => {
    if (s.queryMode === "product") return { stream: s.id, label: s.label, productOnly: true, budget: null, groups: [], skipped: [] };
    const plan = planQueries(keywords, s.capabilities, null);
    if (platform === "dev") {
      // DEV searches tag feeds: one query per distinct tag; keywords that can't be tags are unsupported.
      const tags = new Map<string, string>();
      plan.groups = plan.groups.filter((g) => {
        const term = g.terms[0] ?? "";
        if (g.role === "ambiguous") {
          plan.skipped.push({ term, reason: "unsupported", detail: "DEV tag feeds can't require context words" });
          return false;
        }
        const tag = /^[\p{L}\p{N} -]+$/u.test(term) ? devTag(term) : null;
        if (!tag) {
          plan.skipped.push({ term, reason: "unsupported", detail: "DEV can only be searched by tag, and this keyword can't be a tag" });
          return false;
        }
        if (tags.has(tag)) {
          plan.skipped.push({ term, reason: "duplicate", detail: `Same DEV tag as "${tags.get(tag)}" (#${tag})`, via: tags.get(tag) });
          return false;
        }
        tags.set(tag, term);
        return true;
      });
    }
    if (isLegacySource(platform)) {
      // These adapters build queries from a group's terms; an ambiguous keyword is searched on its own
      // and kept only when a context word appears (local relevance), as in Milestone 2.
      plan.groups = plan.groups.map((g) => (g.role === "ambiguous" ? { ...g, expression: g.terms[0]! } : g));
    }
    return { stream: s.id, label: s.label, productOnly: false, budget, groups: rotate(plan.groups, budget), skipped: plan.skipped };
  });

  const searchedBy = new Map<string, Rotation | null>();
  for (const s of streams) {
    for (const g of s.groups) for (const t of g.terms) searchedBy.set(t, searchedBy.has(t) ? slower(searchedBy.get(t)!, g.rotation) : g.rotation);
  }
  const skipped: SkippedKeyword[] = [];
  for (const s of streams) {
    for (const k of s.skipped) if (!searchedBy.has(k.term) && !skipped.some((x) => x.term === k.term)) skipped.push(k);
  }
  const productOnly = streams.length > 0 && streams.every((s) => s.productOnly);
  const seen = new Set<string>();
  const coverage: KeywordCoverage[] = [];
  for (const k of keywords) {
    const term = k.term.replace(/["()]/g, " ").replace(/\s+/g, " ").trim();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    if (productOnly) {
      coverage.push({ term, status: "not_applicable", detail: "Collects reviews of your product's own page; keywords aren't used", rotation: null });
      continue;
    }
    if (searchedBy.has(term)) {
      const rotation = searchedBy.get(term)!;
      coverage.push({
        term, status: rotation ? "rotating" : "every_check", rotation,
        detail: rotation ? `Takes turns with ${rotation.rotating - 1} other search${rotation.rotating === 2 ? "" : "es"} (${rotation.slots} per check)` : "Searched every check",
      });
      continue;
    }
    const sk = skipped.find((x) => x.term === term) ?? { term, reason: "unsupported" as const, detail: "Not searchable on this platform" };
    if ((sk.reason === "covered" || sk.reason === "duplicate") && sk.via && searchedBy.has(sk.via)) {
      coverage.push({ term, status: sk.reason, detail: sk.detail, via: sk.via, rotation: searchedBy.get(sk.via)! });
    } else {
      coverage.push({ term, status: "unsupported", detail: sk.detail, rotation: null });
    }
  }

  const keywordStream = streamsOf(adapter).find((s) => s.queryMode === "keywords");
  const separate = new Set<string>();
  for (const s of streams) for (const g of s.groups) if (g.terms.length === 1 && g.role !== "ambiguous") separate.add(g.terms[0]!);
  let perCheck = 0;
  for (const s of streams) {
    if (s.productOnly) perCheck += 1;
    for (const g of s.groups) perCheck += g.rotation ? Math.min(1, g.rotation.slots / g.rotation.rotating) : 1;
  }
  return {
    platform, booleanOr: keywordStream?.capabilities.booleanOr ?? false, streams,
    searched: [...searchedBy.keys()], skipped,
    searches: streams.reduce((t, s) => t + (s.productOnly ? 1 : s.groups.length), 0),
    searchesPerCheck: Math.round(perCheck * 100) / 100,
    separate: [...separate], productOnly, keywords: coverage,
  };
}
