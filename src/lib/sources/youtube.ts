// YouTube Data API v3. Needs SignalForge's own API key (Google Cloud).
// Quotas per Google Cloud project, shared by ALL customers (checked 2026-10-14,
// developers.google.com/youtube/v3/determine_quota_cost):
//   search.list         own bucket: 100 calls/day (one combined OR query per product per run)
//   videos.list           1 unit of the 10,000-unit/day pool (statistics + description, 50 ids/call)
//   commentThreads.list   1 unit (top-level comments on matched videos)
// Quotas reset at midnight Pacific time.
// Developer Policies: data obtained without user authorization must not be
// stored longer than 30 days without refreshing it, so items carry a 30-day
// retention date (see API_LIMITATIONS.md).

import { SourceError, secondsUntilPacificMidnight } from "./errors.ts";
import { decodeEntities, excerpt, sum } from "./text.ts";
import type { CandidateMention, SearchRequest, SearchResult, SourceAdapter, SourceContext } from "./types.ts";

const API = "https://www.googleapis.com/youtube/v3";
const MAX_COMMENT_VIDEOS = 5;

interface YtError {
  error?: { code?: number; message?: string; errors?: Array<{ reason?: string }> };
}

interface SearchItem {
  id?: { videoId?: string };
  snippet?: { publishedAt?: string; channelId?: string; channelTitle?: string; title?: string; description?: string };
}

export interface YtVideo {
  id: string;
  snippet?: { publishedAt?: string; channelId?: string; channelTitle?: string; title?: string; description?: string; defaultAudioLanguage?: string; defaultLanguage?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}

export interface YtCommentThread {
  id: string;
  snippet?: {
    videoId?: string;
    totalReplyCount?: number;
    topLevelComment?: {
      id?: string;
      snippet?: {
        textOriginal?: string;
        textDisplay?: string;
        authorDisplayName?: string;
        authorChannelId?: { value?: string };
        likeCount?: number;
        publishedAt?: string;
      };
    };
  };
}

/** `"multi word"|single` — YouTube's search supports `|` as OR. */
export function youtubeQuery(terms: string[]): string {
  return terms
    .slice(0, 5)
    .map((t) => t.replace(/"/g, "").trim())
    .map((t) => (/\s/.test(t) ? `"${t}"` : t))
    .join("|");
}

const n = (v: string | number | undefined) => (v === undefined ? undefined : Number(v));

export function normalizeVideo(v: YtVideo): CandidateMention | null {
  const s = v?.snippet;
  if (!v?.id || !s?.publishedAt) return null;
  const views = n(v.statistics?.viewCount);
  const likes = n(v.statistics?.likeCount);
  const comments = n(v.statistics?.commentCount);
  const engagement: Record<string, number> = {};
  if (views !== undefined) engagement.views = views;
  if (likes !== undefined) engagement.likes = likes;
  if (comments !== undefined) engagement.comments = comments;
  const title = s.title ? decodeEntities(s.title) : null;
  return {
    externalId: `video:${v.id}`,
    sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`,
    parentExternalId: s.channelId ? `channel:${s.channelId}` : null,
    authorExternalId: s.channelId ?? null,
    authorDisplay: s.channelTitle ?? null,
    title,
    content: excerpt(s.description ?? "", 2000),
    language: s.defaultAudioLanguage ?? s.defaultLanguage ?? null,
    publishedAt: new Date(s.publishedAt),
    engagement,
    // Views dwarf everything else; likes + comments are the interaction signal.
    engagementScore: sum([likes, comments]),
    linkedUrl: null,
    matchText: `${title ?? ""}\n${s.description ?? ""}`,
    contextText: null,
  };
}

export function normalizeCommentThread(t: YtCommentThread, videoTitle: string | null): CandidateMention | null {
  const c = t.snippet?.topLevelComment?.snippet;
  const videoId = t.snippet?.videoId;
  if (!t.id || !c?.publishedAt || !videoId) return null;
  const text = c.textOriginal ?? decodeEntities(c.textDisplay ?? "");
  const likes = c.likeCount ?? 0;
  const replies = t.snippet?.totalReplyCount ?? 0;
  return {
    externalId: `comment:${t.id}`,
    sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(t.id)}`,
    parentExternalId: `video:${videoId}`,
    authorExternalId: c.authorChannelId?.value ?? null,
    authorDisplay: c.authorDisplayName ?? null,
    title: videoTitle ? `Comment on: ${videoTitle}` : null,
    content: excerpt(text, 2000),
    publishedAt: new Date(c.publishedAt),
    engagement: { likes, replies },
    engagementScore: sum([likes, replies]),
    linkedUrl: null,
    matchText: text,
    contextText: videoTitle,
  };
}

export function createYoutubeAdapter(apiKey?: string): SourceAdapter {
  async function get<T>(ctx: SourceContext, path: string, params: URLSearchParams, cost: number, signal?: AbortSignal): Promise<T> {
    params.set("key", apiKey ?? "");
    const res = await ctx.request({ url: `${API}/${path}?${params}`, endpoint: path, cost, signal });
    const body = (await res.json().catch(() => ({}))) as T & YtError;
    if (res.ok) return body;
    const reasons = body.error?.errors?.map((e) => e.reason) ?? [];
    if (reasons.includes("quotaExceeded") || reasons.includes("dailyLimitExceeded")) {
      const wait = secondsUntilPacificMidnight(ctx.now());
      await ctx.cooldown(wait, path);
      throw new SourceError("quota", path === "search" ? "YouTube: daily search quota exhausted" : "YouTube: daily API quota exhausted", { retryAfterSeconds: wait, status: res.status });
    }
    if (reasons.includes("rateLimitExceeded") || reasons.includes("userRateLimitExceeded") || res.status === 429) {
      throw new SourceError("rate_limited", "YouTube: rate limited", { retryAfterSeconds: 120, status: res.status });
    }
    if (reasons.includes("commentsDisabled") || reasons.includes("videoNotFound")) {
      throw new SourceError("bad_request", `YouTube: ${reasons[0]}`, { status: res.status });
    }
    if (res.status === 400 && /key/i.test(body.error?.message ?? "")) throw new SourceError("auth", "YouTube: API key rejected", { status: 400 });
    if (res.status === 401 || res.status === 403) throw new SourceError("auth", `YouTube: access denied (${reasons[0] ?? res.status})`, { status: res.status });
    if (res.status >= 500) throw new SourceError("transient", `YouTube: server error (${res.status})`, { status: res.status });
    throw new SourceError("bad_request", `YouTube: request rejected (${res.status})`, { status: res.status });
  }

  return {
    id: "youtube",
    name: "YouTube",
    retentionDays: 30,
    configured: () => (apiKey ? { ok: true } : { ok: false, reason: "YOUTUBE_API_KEY is not set on the server." }),
    // search.list has its own 100/day bucket; we use 95 and keep headroom. Other calls share 10,000 units/day.
    rateLimit: (endpoint) => (endpoint === "search"
      ? { key: "youtube:search", capacity: 5, refillPerSecond: 95 / 86_400 }
      : { key: "youtube:units", capacity: 500, refillPerSecond: 9500 / 86_400 }),

    async searchMentions(req: SearchRequest, ctx: SourceContext): Promise<SearchResult> {
      // One search call per run, by design: the 100/day search quota is shared by every customer.
      const search = await get<{ items?: SearchItem[]; nextPageToken?: string; pageInfo?: { totalResults?: number } }>(
        ctx, "search",
        new URLSearchParams({
          part: "snippet", type: "video", order: "date", maxResults: "50",
          q: youtubeQuery(req.terms),
          publishedAfter: req.window.since.toISOString(),
          publishedBefore: req.window.until.toISOString(),
        }),
        1, req.signal,
      );
      const ids = (search.items ?? []).map((i) => i.id?.videoId).filter((x): x is string => Boolean(x));
      const items: CandidateMention[] = [];
      if (ids.length > 0) {
        const videos = await get<{ items?: YtVideo[] }>(ctx, "videos",
          new URLSearchParams({ part: "snippet,statistics", id: ids.join(","), maxResults: "50" }), 1, req.signal);
        const normalized = (videos.items ?? []).map(normalizeVideo).filter((x): x is CandidateMention => x !== null);
        items.push(...normalized);

        // Comments on the most-discussed matched videos only.
        const commentable = normalized
          .filter((v) => (v.engagement.comments ?? 0) > 0)
          .sort((a, b) => (b.engagement.comments ?? 0) - (a.engagement.comments ?? 0))
          .slice(0, MAX_COMMENT_VIDEOS);
        for (const v of commentable) {
          const videoId = v.externalId.replace(/^video:/, "");
          try {
            const threads = await get<{ items?: YtCommentThread[] }>(ctx, "commentThreads",
              new URLSearchParams({ part: "snippet", videoId, maxResults: "100", order: "time", textFormat: "plainText" }), 1, req.signal);
            for (const t of threads.items ?? []) {
              const m = normalizeCommentThread(t, v.title ?? null);
              if (m && m.publishedAt >= req.window.since) items.push(m);
            }
          } catch (e) {
            if (e instanceof SourceError && e.kind === "bad_request") continue; // comments disabled / video gone
            throw e;
          }
        }
      }
      const capped = Boolean(search.nextPageToken);
      return {
        items,
        complete: !capped,
        incompleteReason: capped
          ? "YouTube returned more than 50 videos; only the newest 50 were collected to stay within the shared daily quota."
          : undefined,
      };
    },

    async validateCredentials(ctx) {
      await get(ctx, "videos", new URLSearchParams({ part: "id", id: "dQw4w9WgXcQ" }), 1);
    },
  };
}
