import { createGithubAdapter } from "./github.ts";
import { hackerNews } from "./hackernews.ts";
import { createStackExchangeAdapter } from "./stackexchange.ts";
import type { PublicSourceId, SourceAdapter } from "./types.ts";
import { createYoutubeAdapter } from "./youtube.ts";

export interface SourceKeys {
  githubToken?: string;
  stackExchangeKey?: string;
  youtubeApiKey?: string;
}

export const PUBLIC_SOURCES: readonly PublicSourceId[] = ["hackernews", "github", "stackexchange", "youtube"];

export function createAdapters(keys: SourceKeys): Record<PublicSourceId, SourceAdapter> {
  return {
    hackernews: hackerNews,
    github: createGithubAdapter(keys.githubToken || undefined),
    stackexchange: createStackExchangeAdapter(keys.stackExchangeKey || undefined),
    youtube: createYoutubeAdapter(keys.youtubeApiKey || undefined),
  };
}

export function isPublicSource(p: string): p is PublicSourceId {
  return (PUBLIC_SOURCES as readonly string[]).includes(p);
}
