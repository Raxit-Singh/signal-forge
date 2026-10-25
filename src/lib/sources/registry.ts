import { createApiDirectAdapters } from "./apidirect/adapters.ts";
import { tikhubPlatforms, withTikhubSearch } from "./tikhub/adapters.ts";
import { withSerperSearch } from "./serper/serper.ts";
import { createGithubAdapter } from "./github.ts";
import { hackerNews } from "./hackernews.ts";
import { appStore, bluesky, dev } from "./official.ts";
import { createStackExchangeAdapter } from "./stackexchange.ts";
import { createGooglePlayAdapter } from "./google-play.ts";
import type { LegacySourceId, PaidSourceId, PublicSourceId, SourceAdapter, StreamSpec } from "./types.ts";
import { createYoutubeAdapter } from "./youtube.ts";
import { CAPS } from "./capabilities.ts";

export interface SourceKeys {
  githubToken?: string;
  stackExchangeKey?: string;
  youtubeApiKey?: string;
  apiDirectKey?: string;
  tikhubKey?: string;
  /** Comma-separated paid platforms searched through TikHub instead of API Direct (x, tiktok, instagram). */
  tikhubPlatforms?: string;
  /** Serper key: Web and News search go through Serper instead of API Direct. */
  serperKey?: string;
}

/** Milestone 2 sources (one stream, "default"; checkpoints always advance and gaps are recorded). */
export const LEGACY_SOURCES: readonly LegacySourceId[] = ["hackernews", "github", "stackexchange", "youtube"];
export const OFFICIAL_SOURCES = [...LEGACY_SOURCES, "bluesky", "dev", "app_store", "google_play"] as const;
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
    google_play: createGooglePlayAdapter(),
    ...withSerperSearch(
      withTikhubSearch(createApiDirectAdapters(keys.apiDirectKey || undefined), keys.tikhubKey || undefined, tikhubPlatforms(keys.tikhubPlatforms)),
      keys.serperKey || undefined,
    ),
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

const LEGACY_CAPS: Record<LegacySourceId, StreamSpec["capabilities"]> = {
  hackernews: CAPS.hackernews, github: CAPS.github, stackexchange: CAPS.stackexchange, youtube: CAPS.youtube,
};

/** Streams of an adapter (Milestone 2 adapters have one implicit "default" stream). */
export function streamsOf(a: SourceAdapter): StreamSpec[] {
  if (a.streams?.length) return a.streams;
  const caps = isLegacySource(a.id) ? LEGACY_CAPS[a.id] : CAPS.hackernews;
  return [{ id: "default", label: "Search", mentionType: "post", queryMode: "keywords", capabilities: caps }];
}
