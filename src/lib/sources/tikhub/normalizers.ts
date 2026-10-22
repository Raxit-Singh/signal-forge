// TikHub response items → CandidateMention. Ids match the API Direct connectors
// (tweet:<id>, video:<id>, media:<id>), so the same post collected through
// either provider is stored once. Shapes observed live on 2026-10-22.

import { excerpt, sum } from "../text.ts";
import type { CandidateMention } from "../types.ts";

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

function engagementOf(fields: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(fields)) {
    const n = num(v);
    if (n !== undefined && n >= 0) out[k] = n;
  }
  return out;
}

const fromEpoch = (s: unknown): Date | null => {
  const n = num(s);
  if (!n || n <= 0) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ------------------------------------------------------------------ X

export interface TikhubTweet {
  type?: string;
  tweet_id?: string;
  screen_name?: string;
  created_at?: string;
  text?: string;
  lang?: string;
  favorites?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  bookmarks?: number;
  views?: string | number;
  conversation_id?: string;
  user_info?: { screen_name?: string; rest_id?: string; name?: string };
}

export function normalizeTikhubTweet(t: TikhubTweet): CandidateMention | null {
  if (t.type && t.type !== "tweet") return null;
  const id = t.tweet_id && /^\d{5,25}$/.test(t.tweet_id) ? t.tweet_id : null;
  const publishedAt = t.created_at ? new Date(t.created_at) : null;
  if (!id || !publishedAt || Number.isNaN(publishedAt.getTime())) return null;
  const handle = t.screen_name ?? t.user_info?.screen_name ?? null;
  const likes = num(t.favorites);
  const retweets = num(t.retweets);
  const replies = num(t.replies);
  const quotes = num(t.quotes);
  const isReply = Boolean(t.conversation_id && t.conversation_id !== id);
  return {
    externalId: `tweet:${id}`,
    sourceUrl: `https://x.com/${handle ?? "i/web"}/status/${id}`,
    authorExternalId: handle,
    authorDisplay: handle ? `@${handle}` : null,
    title: handle ? `@${handle} on X` : null,
    content: excerpt(t.text, 4000),
    language: t.lang ?? null,
    publishedAt,
    engagement: engagementOf({ likes, retweets, replies, quotes, bookmarks: t.bookmarks, views: t.views }),
    engagementScore: sum([likes, retweets, replies, quotes]),
    matchText: t.text ?? "",
    mentionType: isReply ? "reply" : "post",
    dataProvider: "tikhub",
  };
}

// ------------------------------------------------------------------ TikTok

export interface TikhubTiktokItem {
  aweme_info?: {
    aweme_id?: string;
    desc?: string;
    create_time?: number;
    region?: string;
    share_url?: string;
    is_ads?: boolean;
    author?: { unique_id?: string; uid?: string; nickname?: string };
    statistics?: { play_count?: number; digg_count?: number; comment_count?: number; share_count?: number; collect_count?: number };
  };
}

export function normalizeTikhubTiktok(item: TikhubTiktokItem): CandidateMention | null {
  const v = item.aweme_info;
  if (!v || v.is_ads) return null;
  const id = v.aweme_id && /^\d{5,25}$/.test(v.aweme_id) ? v.aweme_id : null;
  const publishedAt = fromEpoch(v.create_time);
  if (!id || !publishedAt) return null;
  const handle = v.author?.unique_id ?? null;
  const s = v.statistics ?? {};
  const likes = num(s.digg_count);
  const comments = num(s.comment_count);
  const shares = num(s.share_count);
  return {
    externalId: `video:${id}`,
    sourceUrl: handle ? `https://www.tiktok.com/@${handle}/video/${id}` : `https://www.tiktok.com/video/${id}`,
    authorExternalId: v.author?.uid ?? handle,
    authorDisplay: handle ? `@${handle}` : null,
    title: handle ? `@${handle} on TikTok` : null,
    content: excerpt(v.desc, 2000),
    publishedAt,
    engagement: engagementOf({ views: s.play_count, likes, comments, shares }),
    engagementScore: sum([likes, comments, shares]),
    matchText: v.desc ?? "",
    mentionType: "video",
    dataProvider: "tikhub",
  };
}

// ------------------------------------------------------------------ Instagram

export interface TikhubInstagramMedia {
  id?: string;
  code?: string;
  taken_at?: number;
  caption?: { text?: string } | null;
  user?: { username?: string; full_name?: string; id?: string; pk?: string } | null;
  like_count?: number;
  comment_count?: number;
  play_count?: number;
  ig_play_count?: number;
  reshare_count?: number;
  product_type?: string;
}

/** Every media object in a search response (the reels list is nested inside layout sections). */
export function instagramMediaIn(data: unknown): TikhubInstagramMedia[] {
  const out: TikhubInstagramMedia[] = [];
  const seen = new Set<string>();
  const walk = (o: unknown, depth: number) => {
    if (!o || typeof o !== "object" || depth > 12) return;
    if (Array.isArray(o)) {
      for (const v of o) walk(v, depth + 1);
      return;
    }
    const r = o as Record<string, unknown>;
    if (typeof r.taken_at === "number" && typeof r.code === "string") {
      const m = r as TikhubInstagramMedia;
      const key = String(m.id ?? m.code);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(m);
      }
      return;
    }
    for (const v of Object.values(r)) walk(v, depth + 1);
  };
  walk(data, 0);
  return out;
}

export function normalizeTikhubInstagram(m: TikhubInstagramMedia): CandidateMention | null {
  const mediaId = m.id ? String(m.id).split("_")[0] : null;
  const code = m.code && /^[A-Za-z0-9_-]{5,40}$/.test(m.code) ? m.code : null;
  const publishedAt = fromEpoch(m.taken_at);
  if (!(mediaId || code) || !publishedAt) return null;
  const handle = m.user?.username ?? null;
  const text = m.caption?.text ?? "";
  const likes = num(m.like_count);
  const comments = num(m.comment_count);
  const shares = num(m.reshare_count);
  const isReel = m.product_type === "clips" || m.product_type === undefined;
  return {
    externalId: `media:${mediaId ?? code}`,
    sourceUrl: code ? `https://www.instagram.com/${isReel ? "reel" : "p"}/${code}/` : "https://www.instagram.com/",
    authorExternalId: m.user?.id ?? m.user?.pk ?? handle,
    authorDisplay: handle ? `@${handle}` : null,
    title: handle ? `@${handle} on Instagram` : null,
    content: excerpt(text, 2200),
    publishedAt,
    engagement: engagementOf({ likes, comments, shares, views: m.ig_play_count ?? m.play_count }),
    engagementScore: sum([likes, comments, shares]),
    matchText: text,
    mentionType: "post",
    dataProvider: "tikhub",
  };
}
