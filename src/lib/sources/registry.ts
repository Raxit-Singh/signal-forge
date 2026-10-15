import { createApiDirectAdapters } from "./apidirect/adapters.ts";
import { createGithubAdapter } from "./github.ts";
import { hackerNews } from "./hackernews.ts";
import { appStore, bluesky, dev } from "./official.ts";
import { createStackExchangeAdapter } from "./stackexchange.ts";
import type { LegacySourceId, PaidSourceId, PublicSourceId, SourceAdapter, StreamSpec } from "./types.ts";
import { createYoutubeAdapter } from "./youtube.ts";
import { CAPS } from "./capabilities.ts";

export interface SourceKeys {
  githubToken?: string;
  stackExchangeKey?: string;
  youtubeApiKey?: string;
  apiDirectKey?: string;
}

/** Milestone 2 sources: queries come from the SQL keyword sync (one stream, "default"). */
export const LEGACY_SOURCES: readonly LegacySourceId[] = ["hackernews", "github", "stackexchange", "youtube"];
export const OFFICIAL_SOURCES = [...LEGACY_SOURCES, "bluesky", "dev", "app_store"] as const;
export const PAID_SOURCES: readonly PaidSourceId[] = [
  "reddit", "x", "linkedin", "tiktok", "instagram", "facebook", "substack", "web", "news", "trustpilot",
];
export const PUBLIC_SOURCES: readonly PublicSourceId[] = [...OFFICIAL_SOURCES, ...PAID_SOURCES];

export function createAdapters(keys: SourceKeys): Record<PublicSourceId, SourceAdapter> {
  return {
    hackernews: hackerNews,
    github: createGithubAdapter(keys.githubToken || undefined),
    stackexchange: createStackExchangeAdapter(keys.stackExchangeKey || undefined),
    youtube: createYoutubeAdapter(keys.youtubeApiKey || undefined),
    bluesky,
    dev,
    app_store: appStore,
    ...createApiDirectAdapters(keys.apiDirectKey || undefined),
  };
}

export function isPublicSource(p: string): p is PublicSourceId {
  return (PUBLIC_SOURCES as readonly string[]).includes(p);
}

export function isPaidSource(p: string): p is PaidSourceId {
  return (PAID_SOURCES as readonly string[]).includes(p);
}

export function isLegacySource(p: string): p is LegacySourceId {
  return (LEGACY_SOURCES as readonly string[]).includes(p);
}

const LEGACY_STREAM: StreamSpec = {
  id: "default", label: "Search", mentionType: "post", queryMode: "keywords",
  capabilities: { ...CAPS.devArticles, maxQueryLength: 256, maxTerms: 5, wordMatch: true },
};

/** Streams of an adapter (legacy adapters have one implicit "default" stream). */
export function streamsOf(a: SourceAdapter): StreamSpec[] {
  return a.streams?.length ? a.streams : [LEGACY_STREAM];
}
