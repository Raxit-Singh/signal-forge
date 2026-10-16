// Query capabilities each connector declares to the optimizer. Sources:
// API Direct "Boolean Search" + "Pagination" docs (2026-10-15) and each
// official API's documentation. `maxPagesPerRun` is a per-job safety bound
// (2026-10-16 V2): page-billed calls request only the pages the arrival-rate
// estimate needs (arrival.ts → pagesToRequest), and overflowing windows are
// continued by later jobs where the provider allows (collection-profile.ts).

import type { QueryCapabilities } from "./types.ts";

const base: QueryCapabilities = {
  booleanOr: false, grouping: false, exactPhrase: false, maxQueryLength: 500, maxTerms: 1,
  dateFilter: "none", sortNewest: false, pagination: "none", maxPagesPerRun: 1, wordMatch: true,
};

export const CAPS = {
  // Reddit search operators: AND OR NOT - ( ), phrases.
  redditPosts: { ...base, booleanOr: "OR", grouping: true, exactPhrase: true, maxTerms: 10, dateFilter: "preset", sortNewest: true, pagination: "page", maxPagesPerRun: 3 },
  // Comment search: no date filter; one call with `pages` (billed per page requested).
  redditComments: { ...base, booleanOr: "OR", grouping: true, exactPhrase: true, maxTerms: 10, dateFilter: "none", sortNewest: true, pagination: "pages", maxPagesPerRun: 10 },
  // X advanced search: phrases, OR, -, ( ). start_date/end_date are whole UTC days.
  xPosts: { ...base, booleanOr: "OR", grouping: true, exactPhrase: true, maxTerms: 10, dateFilter: "range", sortNewest: true, pagination: "pages", maxPagesPerRun: 10 },
  // LinkedIn boolean search; phrases are matched loosely.
  linkedinPosts: { ...base, booleanOr: "OR", grouping: true, exactPhrase: false, maxTerms: 6, dateFilter: "preset", sortNewest: true, pagination: "page", maxPagesPerRun: 2 },
  // Keyword-only (operators are literal text). TikTok matches loosely.
  tiktokVideos: { ...base, dateFilter: "preset", sortNewest: true, pagination: "pages", maxPagesPerRun: 10 },
  // Keyword-only, relevance-ranked, no date filter or sort.
  instagramPosts: { ...base, dateFilter: "none", sortNewest: false, pagination: "pages", maxPagesPerRun: 2 },
  // Keyword-only; every word must appear.
  facebookPosts: { ...base, dateFilter: "range", sortNewest: true, pagination: "pages", maxPagesPerRun: 10 },
  substackPosts: { ...base, exactPhrase: false, dateFilter: "preset", sortNewest: false, pagination: "page", maxPagesPerRun: 2 },
  substackNotes: { ...base, dateFilter: "none", sortNewest: true, pagination: "pages", maxPagesPerRun: 10 },
  // Google operators: phrases, OR, -, site:.
  webSearch: { ...base, booleanOr: "OR", grouping: true, exactPhrase: true, maxTerms: 6, dateFilter: "preset", sortNewest: false, pagination: "pages", maxPagesPerRun: 1 },
  newsArticles: { ...base, booleanOr: "OR", exactPhrase: true, maxTerms: 4, dateFilter: "preset", sortNewest: false, pagination: "limit", maxPagesPerRun: 1 },
  // Reviews of the product's own business page; no keyword query.
  trustpilotReviews: { ...base, dateFilter: "preset", sortNewest: true, pagination: "pages", maxPagesPerRun: 5 },
  // Bluesky searchPosts: phrases, since/until, sort=latest, cursor; no OR.
  blueskyPosts: { ...base, exactPhrase: true, maxQueryLength: 300, dateFilter: "range", sortNewest: true, pagination: "cursor", maxPagesPerRun: 5 },
  // DEV: tag feed only (no documented full-text search).
  devArticles: { ...base, maxQueryLength: 30, dateFilter: "none", sortNewest: true, pagination: "page", maxPagesPerRun: 1, wordMatch: false },
  appStoreReviews: { ...base, dateFilter: "none", sortNewest: true, pagination: "page", maxPagesPerRun: 2 },
  // Milestone 2 sources. Each adapter builds its own query from a group's terms.
  // Hacker News (Algolia) and Stack Exchange: one search per keyword, all words required.
  hackernews: { ...base, maxQueryLength: 256, dateFilter: "range", sortNewest: true, pagination: "page", maxPagesPerRun: 5 },
  stackexchange: { ...base, maxQueryLength: 256, dateFilter: "range", sortNewest: true, pagination: "page", maxPagesPerRun: 5 },
  // GitHub issue search: OR of quoted terms, at most 5 operators per query.
  github: { ...base, booleanOr: "OR", exactPhrase: true, maxTerms: 5, maxQueryLength: 256, dateFilter: "range", sortNewest: true, pagination: "page", maxPagesPerRun: 5 },
  // YouTube search.list: `|` as OR; quota-limited, so few pages.
  youtube: { ...base, booleanOr: "|", exactPhrase: true, maxTerms: 5, maxQueryLength: 256, dateFilter: "range", sortNewest: true, pagination: "cursor", maxPagesPerRun: 2 },
} as const satisfies Record<string, QueryCapabilities>;
