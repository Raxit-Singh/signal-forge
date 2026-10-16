// What each search stream can retrieve, and how (pagination audit, 2026-10-16).
//
// PROVIDER limits are the API's own (page sizes, page caps, date filters, search
// depth). APPLICATION limits are SignalForge's per-job safety bounds: they keep
// one job short and its spend predictable, but they are NOT coverage limits —
// a window that overflows a job is continued by later jobs wherever the provider
// can resume (date ranges or page offsets). Where it can't, the run is recorded
// as partial and brand-safe pacing checks the search more often instead.
//
// Page sizes: documented, or measured in the authorized live test (2026-10-16)
// where the docs are silent (marked "measured"). Billing per API Direct's
// "How Billing Works" (endpoints.ts).

import type { PublicSourceId } from "./types.ts";

export type ResumeMode =
  /** Continue an overflowing window by moving its end back to the oldest result read. */
  | "range"
  /** Continue with the next page offset of the same query. */
  | "page"
  /** The provider exposes nothing beyond what one call returns (newest-first cap or relevance ranking). */
  | "none";

export interface CollectionProfile {
  /** Results per page (provider). */
  perPage: number;
  /** Pages one query can reach at all (provider), or null when unlimited by date-range paging. */
  providerMaxPages: number | null;
  /** Pages one job may read (application safety bound, not a coverage limit). */
  maxPagesPerJob: number;
  /** "pages": one call bills every requested page; "request": each page is a separate billed call; "free". */
  billing: "pages" | "request" | "free";
  resume: ResumeMode;
  /** Date filter works in whole UTC days (finer splitting impossible). */
  dayGranularity?: boolean;
  /** Results ordered newest-first (a partial page then proves the window is complete). */
  sortNewest: boolean;
  /** Days back the provider's search reaches (null = no documented limit). */
  historyDays: number | null;
  historyNote: string;
}

const free = (p: Omit<CollectionProfile, "billing">): CollectionProfile => ({ ...p, billing: "free" });

export const COLLECTION_PROFILES: Record<string, CollectionProfile> = {
  // Algolia: up to 1,000 hits per query (10 pages of 100); exact second ranges → resumable by range.
  "hackernews/default": free({ perPage: 100, providerMaxPages: 10, maxPagesPerJob: 5, resume: "range", sortNewest: true, historyDays: null, historyNote: "Full archive (search_by_date with exact ranges)." }),
  // GitHub search: 1,000 results per query; created:A..B ranges → resumable by range.
  "github/default": free({ perPage: 100, providerMaxPages: 10, maxPagesPerJob: 5, resume: "range", sortNewest: true, historyDays: null, historyNote: "Full issue history (1,000 results per query; older results reached by narrowing the date range)." }),
  "stackexchange/default": free({ perPage: 100, providerMaxPages: null, maxPagesPerJob: 5, resume: "range", sortNewest: true, historyDays: null, historyNote: "Full Stack Overflow history (fromdate/todate)." }),
  // YouTube: 100 searches/day shared by every customer, so windows aren't chained (quota).
  "youtube/default": free({ perPage: 50, providerMaxPages: null, maxPagesPerJob: 2, resume: "none", sortNewest: true, historyDays: null, historyNote: "Searchable by date, but the shared quota (100 searches/day) limits history to the newest 100 videos per keyword group." }),
  // Bluesky: until-paging (cursor refused unauthenticated); the index is not a complete archive.
  "bluesky/posts": free({ perPage: 100, providerMaxPages: null, maxPagesPerJob: 5, resume: "range", sortNewest: true, historyDays: null, historyNote: "What Bluesky's search index holds (not a complete archive)." }),
  "dev/default": free({ perPage: 100, providerMaxPages: 1, maxPagesPerJob: 1, resume: "none", sortNewest: true, historyDays: null, historyNote: "Newest 100 articles per tag (tag feed; no full-text search)." }),
  "app_store/default": free({ perPage: 50, providerMaxPages: 10, maxPagesPerJob: 2, resume: "none", sortNewest: true, historyDays: null, historyNote: "Most recent reviews only (Apple's feed: up to 500)." }),
  // API Direct
  "reddit/posts": { perPage: 20, providerMaxPages: 12, maxPagesPerJob: 3, billing: "request", resume: "page", sortNewest: true, historyDays: 365, historyNote: "Up to 12 months (posted_ago 12m) and 12 pages (240 posts) per query." },
  "reddit/comments": { perPage: 25, providerMaxPages: 10, maxPagesPerJob: 10, billing: "pages", resume: "none", sortNewest: true, historyDays: null, historyNote: "No date filter: the newest 250 comments per query (measured ~22–25 per page)." },
  "x/posts": { perPage: 20, providerMaxPages: 20, maxPagesPerJob: 10, billing: "pages", resume: "range", dayGranularity: true, sortNewest: true, historyDays: null, historyNote: "start_date/end_date in whole UTC days; days with more than 400 matching posts can't be read completely." },
  "linkedin/posts": { perPage: 20, providerMaxPages: 25, maxPagesPerJob: 3, billing: "request", resume: "page", sortNewest: true, historyDays: 30, historyNote: "Last 30 days only (posted_ago 30d), 25 pages per query." },
  "tiktok/videos": { perPage: 25, providerMaxPages: 10, maxPagesPerJob: 10, billing: "pages", resume: "none", sortNewest: true, historyDays: 180, historyNote: "Up to 180 days (publish_time), 10 pages per query (measured ~25–28 per page)." },
  "instagram/posts": { perPage: 10, providerMaxPages: 20, maxPagesPerJob: 2, billing: "pages", resume: "none", sortNewest: false, historyDays: null, historyNote: "Relevance-ranked with no date filter: a sample, never a complete history." },
  "facebook/posts": { perPage: 20, providerMaxPages: 15, maxPagesPerJob: 10, billing: "pages", resume: "range", dayGranularity: true, sortNewest: true, historyDays: null, historyNote: "start_date/end_date in whole UTC days." },
  "substack/posts": { perPage: 20, providerMaxPages: 101, maxPagesPerJob: 3, billing: "request", resume: "page", sortNewest: false, historyDays: 365, historyNote: "Relevance-ranked, up to 12 months; has_next_page shows when more exist." },
  "substack/notes": { perPage: 5, providerMaxPages: 250, maxPagesPerJob: 10, billing: "pages", resume: "none", sortNewest: true, historyDays: null, historyNote: "No date filter: newest notes only." },
  "web/results": { perPage: 10, providerMaxPages: 10, maxPagesPerJob: 1, billing: "pages", resume: "none", sortNewest: false, historyDays: 365, historyNote: "Ranked web results without publication dates (time filter up to a year)." },
  "news/articles": { perPage: 100, providerMaxPages: 1, maxPagesPerJob: 1, billing: "request", resume: "none", sortNewest: false, historyDays: 365, historyNote: "Up to 100 articles per query, within a year." },
  "trustpilot/reviews": { perPage: 20, providerMaxPages: 10, maxPagesPerJob: 5, billing: "pages", resume: "none", sortNewest: true, historyDays: 365, historyNote: "Up to 12 months, 200 newest reviews per query." },
};

/** Sources whose search can't promise completeness even without page caps (relevance-ranked or tag-only). */
export const INHERENTLY_PARTIAL: ReadonlySet<string> = new Set(["instagram", "web", "substack", "dev"]);

export function collectionProfile(platform: PublicSourceId | string, stream: string): CollectionProfile {
  return COLLECTION_PROFILES[`${platform}/${stream}`]
    ?? COLLECTION_PROFILES[`${platform}/default`]
    ?? { perPage: 20, providerMaxPages: 1, maxPagesPerJob: 1, billing: "free", resume: "none", sortNewest: false, historyDays: null, historyNote: "Unknown source." };
}

/** Results one job can read for a stream (per-job bound × page size). */
export function jobCapacity(p: CollectionProfile): number {
  const pages = p.providerMaxPages === null ? p.maxPagesPerJob : Math.min(p.providerMaxPages, p.maxPagesPerJob);
  return pages * p.perPage;
}

/** Results one query can ever expose without resuming (provider limit), or null when date-range paging removes it. */
export function providerWindowCapacity(p: CollectionProfile): number | null {
  if (p.resume === "range") return null;
  return p.providerMaxPages === null ? null : p.providerMaxPages * p.perPage;
}

/**
 * Capacity the scheduler plans with: range sources can chain continuation jobs
 * (per-job capacity, resumable); page sources can page on to the provider's limit
 * within one window; the rest get one call's worth.
 */
export function planningCapacity(p: CollectionProfile): { capacity: number | null; resumable: boolean } {
  if (p.resume === "range") return { capacity: jobCapacity(p), resumable: true };
  if (p.resume === "page") return { capacity: providerWindowCapacity(p), resumable: false };
  return { capacity: jobCapacity(p), resumable: false };
}

export interface HistorySupport {
  /** Earliest moment the source can search back to for this request. */
  supportedSince: Date;
  /** The whole requested range is searchable. */
  full: boolean;
  note: string | null;
}

/** How much of a requested history range a stream can actually search. */
export function historySupport(p: CollectionProfile, requestedSince: Date, now: Date): HistorySupport {
  // Without a way to resume, only what one query returns is reachable, whatever the dates.
  if (p.historyDays === null) return { supportedSince: requestedSince, full: p.resume !== "none", note: p.resume === "none" ? p.historyNote : null };
  const earliest = new Date(now.getTime() - p.historyDays * 86_400_000);
  if (earliest <= requestedSince) return { supportedSince: requestedSince, full: p.resume !== "none", note: p.resume === "none" ? p.historyNote : null };
  return { supportedSince: earliest, full: false, note: p.historyNote };
}
