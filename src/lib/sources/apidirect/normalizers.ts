// API Direct responses → CandidateMention. Pure; unit-tested with fixtures.
// Rules:
//   * stable external ids come from platform ids in the URL or payload; when a
//     platform returns none (Reddit comments, web/news results) the id is a hash
//     of fields that don't change when the item is re-found
//   * `date` strings carry no zone; API Direct's examples that also include a
//     Unix timestamp match UTC, so they are parsed as UTC; timestamps win when present
//   * only the snippet the API returns is stored (never presented as full text)

import { createHash } from "node:crypto";
import { canonicalLink, excerpt, httpsUrl, sum } from "../text.ts";
import type { CandidateMention, ExpansionParent } from "../types.ts";
import type {
  FacebookComment, FacebookPost, InstagramComment, InstagramPost, LinkedinPost, NewsArticle, RedditComment, RedditPost,
  SubstackNote, SubstackPost, TiktokComment, TiktokVideo, TrustpilotReview, Tweet, WebResult,
} from "./schemas.ts";

const sha = (s: string, n = 32) => createHash("sha256").update(s).digest("hex").slice(0, n);
const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** "YYYY-MM-DD HH:MM:SS" (UTC per API Direct examples) or ISO; Unix seconds preferred when given. */
export function parseApiDate(date: string | null | undefined, unixSeconds?: number | null): Date | null {
  if (typeof unixSeconds === "number" && Number.isFinite(unixSeconds) && unixSeconds > 0) return new Date(unixSeconds * 1000);
  if (!date) return null;
  const s = date.trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(s);
  const time = m?.[2] ?? "";
  const d = m ? new Date(`${m[1]}T${time.length === 5 ? `${time}:00` : time}Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function engagementOf(fields: Record<string, number | null | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(fields)) {
    const n = num(v);
    if (n !== undefined) out[k] = n;
  }
  return out;
}

const join = (...parts: Array<string | null | undefined>) => parts.filter((p) => p && p.trim()).join("\n");

// ------------------------------------------------------------------ Reddit

/** Reddit post id from a thread URL (`/comments/<id>/`). */
export function redditPostId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/(^|\.)reddit\.com$/i.test(u.hostname) && u.hostname !== "redd.it") return null;
    return /\/comments\/([a-z0-9]+)/i.exec(u.pathname)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export function normalizeRedditPost(p: RedditPost): CandidateMention | null {
  const publishedAt = parseApiDate(p.date);
  const id = redditPostId(p.url);
  if (!publishedAt || !id) return null;
  const upvotes = num(p.upvotes);
  const comments = num(p.comments);
  return {
    externalId: `post:${id}`,
    sourceUrl: p.url,
    authorExternalId: p.author ?? null,
    authorDisplay: p.author ? `u/${p.author}` : null,
    title: p.title ?? null,
    content: excerpt(p.snippet, 4000),
    publishedAt,
    engagement: engagementOf({ upvotes, comments, crossposts: p.crossposts }),
    engagementScore: sum([upvotes, comments]),
    matchText: join(p.title, p.snippet),
    community: p.subreddit ? `r/${p.subreddit.replace(/^r\//, "")}` : null,
    mentionType: "post",
    dataProvider: "apidirect",
  };
}

/**
 * Reddit comment search returns no comment id or permalink: `url` is the parent
 * thread, or the article/image/video a link post shares. The stable id hashes
 * author + timestamp + parent (unchanged by edits); content is only used when
 * the author is missing (deleted accounts).
 */
export function normalizeRedditComment(c: RedditComment): CandidateMention | null {
  const publishedAt = parseApiDate(c.date);
  if (!publishedAt || !c.url) return null;
  const postId = redditPostId(c.url);
  const parent = postId ? `post:${postId}` : canonicalLink(c.url) ?? c.url;
  const author = c.author && c.author !== "[deleted]" ? c.author : null;
  const idSource = [author ?? `anon:${(c.snippet ?? "").slice(0, 200)}`, publishedAt.toISOString(), parent].join("|");
  const sub = c.subreddit ? `r/${c.subreddit.replace(/^r\//, "")}` : null;
  const upvotes = num(c.upvotes);
  return {
    externalId: `comment:${sha(idSource)}`,
    sourceUrl: c.url,
    parentExternalId: postId ? `post:${postId}` : null,
    authorExternalId: author,
    authorDisplay: author ? `u/${author}` : null,
    title: sub ? `Comment in ${sub}` : "Reddit comment",
    content: excerpt(c.snippet, 4000),
    publishedAt,
    engagement: engagementOf({ upvotes, post_upvotes: c.post_upvotes, post_comments: c.post_comments }),
    engagementScore: sum([upvotes]),
    matchText: c.snippet ?? "",
    community: sub,
    mentionType: "comment",
    collectionMethod: "comment_search",
    linkTarget: postId ? "thread" : "shared_content",
    dataProvider: "apidirect",
  };
}

// ------------------------------------------------------------------ X

export function tweetId(url: string | null | undefined): string | null {
  if (!url) return null;
  return /\/status(?:es)?\/(\d{5,25})/.exec(url)?.[1] ?? null;
}

export function normalizeTweet(
  t: Tweet,
  via?: { method: "reply_expansion" | "quote_expansion"; parentId: string; parentText: string | null },
): CandidateMention | null {
  const publishedAt = parseApiDate(t.date);
  const id = tweetId(t.url);
  if (!publishedAt || !id) return null;
  const likes = num(t.likes);
  const retweets = num(t.retweets);
  const replies = num(t.replies);
  const quotes = num(t.quotes);
  const type = via?.method === "quote_expansion" || t.is_quote ? "quote" : via?.method === "reply_expansion" || t.is_reply ? "reply" : "post";
  return {
    externalId: `tweet:${id}`,
    // x.com is the canonical host; twitter.com links redirect there.
    sourceUrl: t.url.replace(/^https:\/\/(www\.|mobile\.)?twitter\.com\//, "https://x.com/"),
    parentExternalId: via ? `tweet:${via.parentId}` : null,
    authorExternalId: t.author ?? null,
    authorDisplay: t.author ? `@${t.author}` : null,
    title: t.author ? `@${t.author} on X` : null,
    content: excerpt(t.snippet, 4000),
    language: t.lang ?? null,
    publishedAt,
    engagement: engagementOf({ likes, retweets, replies, quotes, bookmarks: t.bookmarks, views: t.views }),
    engagementScore: sum([likes, retweets, replies, quotes]),
    matchText: t.snippet ?? "",
    contextText: via?.parentText ?? null,
    mentionType: type,
    collectionMethod: via?.method ?? "keyword_search",
    dataProvider: "apidirect",
  };
}

export function tweetParent(m: CandidateMention): ExpansionParent | null {
  const id = m.externalId.startsWith("tweet:") ? m.externalId.slice(6) : null;
  if (!id) return null;
  return {
    externalId: m.externalId, platformId: id, sourceUrl: m.sourceUrl, title: m.content ?? null,
    commentCount: (m.engagement.replies ?? 0) + (m.engagement.quotes ?? 0), publishedAt: m.publishedAt,
  };
}

// ------------------------------------------------------------------ LinkedIn

/**
 * LinkedIn activity ids carry their creation time (ms since epoch) in the top 41
 * bits. Live check (2026-10-16): API Direct's LinkedIn `date` was exactly 2 h ahead
 * of this for 20/20 posts (a UTC+2 local time, not UTC), so the id is preferred.
 */
export function linkedinActivityTime(url: string | null | undefined, urn: string | null | undefined): Date | null {
  const id = /activity-(\d{16,20})/.exec(url ?? "")?.[1] ?? /urn:li:activity:(\d{16,20})/.exec(urn ?? "")?.[1];
  if (!id) return null;
  const ms = Number(BigInt(id) >> 22n);
  // Sanity: LinkedIn's era (2010+) and not in the future.
  return ms > Date.UTC(2010, 0, 1) && ms < Date.now() + 5 * 60_000 ? new Date(ms) : null;
}

export function normalizeLinkedinPost(p: LinkedinPost): CandidateMention | null {
  const stated = parseApiDate(p.date);
  const fromId = linkedinActivityTime(p.url, p.urn);
  // The stated date is a local time of unknown zone; within a day of the id time, trust the id.
  const publishedAt = fromId && (!stated || Math.abs(stated.getTime() - fromId.getTime()) <= 14 * 3_600_000) ? fromId : stated;
  const urn = p.urn ?? (p.url ? `url:${sha(canonicalLink(p.url) ?? p.url)}` : null);
  if (!publishedAt || !urn) return null;
  const likes = num(p.likes);
  const comments = num(p.comments);
  const shares = num(p.shares);
  return {
    externalId: urn,
    sourceUrl: p.url,
    authorExternalId: p.author ?? null,
    authorDisplay: p.author ?? null,
    title: p.author ? `${p.author} on LinkedIn` : null,
    content: excerpt(p.snippet, 4000),
    publishedAt,
    engagement: engagementOf({ likes, comments, shares }),
    engagementScore: sum([likes, comments, shares]),
    linkedUrl: canonicalLink(p.article?.url),
    matchText: join(p.snippet, p.article?.title),
    mentionType: "post",
    dataProvider: "apidirect",
  };
}

// ------------------------------------------------------------------ TikTok

export function tiktokVideoId(url: string | null | undefined): string | null {
  return url ? /\/video\/(\d{5,25})/.exec(url)?.[1] ?? null : null;
}

export function normalizeTiktokVideo(v: TiktokVideo): CandidateMention | null {
  const publishedAt = parseApiDate(v.date);
  const id = tiktokVideoId(v.url);
  // Paid placements are advertising, not mentions.
  if (!publishedAt || !id || v.is_ad) return null;
  const likes = num(v.likes);
  const comments = num(v.comments);
  const shares = num(v.shares);
  return {
    externalId: `video:${id}`,
    sourceUrl: v.url,
    authorExternalId: v.author ?? null,
    authorDisplay: v.author ? `@${v.author}` : null,
    title: v.author ? `@${v.author} on TikTok` : null,
    content: excerpt(v.snippet ?? v.title, 2000),
    publishedAt,
    engagement: engagementOf({ views: v.play_count, likes, comments, shares }),
    engagementScore: sum([likes, comments, shares]),
    matchText: join(v.snippet ?? v.title),
    mentionType: "video",
    dataProvider: "apidirect",
  };
}

export function normalizeTiktokComment(c: TiktokComment, parent: ExpansionParent): CandidateMention | null {
  const publishedAt = parseApiDate(c.date, c.date_timestamp);
  if (!publishedAt || !c.comment_id || !c.text) return null;
  const likes = num(c.likes);
  return {
    externalId: `comment:${c.comment_id}`,
    // TikTok has no comment permalinks: the link opens the video.
    sourceUrl: parent.sourceUrl,
    parentExternalId: parent.externalId,
    authorExternalId: c.author_id ?? c.author ?? null,
    authorDisplay: c.author ? `@${c.author}` : null,
    title: "Comment on a TikTok video",
    content: excerpt(c.text, 2000),
    publishedAt,
    engagement: engagementOf({ likes, replies: c.reply_count }),
    engagementScore: sum([likes, c.reply_count]),
    matchText: c.text,
    contextText: parent.title,
    mentionType: "comment",
    collectionMethod: "comment_expansion",
    linkTarget: "thread",
    dataProvider: "apidirect",
  };
}

// ------------------------------------------------------------------ Instagram

export function instagramShortcode(url: string | null | undefined): string | null {
  return url ? /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/.exec(url)?.[1] ?? null : null;
}

export function normalizeInstagramPost(p: InstagramPost): CandidateMention | null {
  const publishedAt = parseApiDate(p.date);
  const code = instagramShortcode(p.url);
  const id = p.media_id ?? code;
  if (!publishedAt || !id) return null;
  const likes = num(p.likes);
  const comments = num(p.comments);
  const shares = num(p.shares);
  return {
    externalId: `media:${id}`,
    sourceUrl: p.url,
    authorExternalId: p.author ?? null,
    authorDisplay: p.author ? `@${p.author}` : null,
    title: p.author ? `@${p.author} on Instagram` : null,
    content: excerpt(p.snippet, 2200),
    publishedAt,
    engagement: engagementOf({ likes, comments, shares, views: p.views }),
    engagementScore: sum([likes, comments, shares]),
    matchText: p.snippet ?? "",
    mentionType: "post",
    dataProvider: "apidirect",
  };
}

export function normalizeInstagramComment(c: InstagramComment, parent: ExpansionParent): CandidateMention | null {
  const publishedAt = parseApiDate(c.date, c.date_timestamp);
  if (!publishedAt || !c.comment_id || !c.text) return null;
  const direct = c.url ? httpsUrl(c.url) : null;
  const likes = num(c.likes);
  return {
    externalId: `comment:${c.comment_id}`,
    sourceUrl: direct ?? parent.sourceUrl,
    parentExternalId: parent.externalId,
    authorExternalId: c.author_id ?? c.author ?? null,
    authorDisplay: c.author ? `@${c.author}` : null,
    title: "Comment on an Instagram post",
    content: excerpt(c.text, 2000),
    publishedAt,
    engagement: engagementOf({ likes, replies: c.reply_count }),
    engagementScore: sum([likes, c.reply_count]),
    matchText: c.text,
    contextText: parent.title,
    mentionType: "comment",
    collectionMethod: "comment_expansion",
    linkTarget: direct ? "item" : "thread",
    dataProvider: "apidirect",
  };
}

// ------------------------------------------------------------------ Facebook

export function normalizeFacebookPost(p: FacebookPost): CandidateMention | null {
  const publishedAt = parseApiDate(p.date, p.timestamp);
  if (!publishedAt || !p.post_id) return null;
  const reactions = num(p.reactions_count);
  const comments = num(p.comments_count);
  const shares = num(p.reshare_count);
  return {
    externalId: `post:${p.post_id}`,
    sourceUrl: p.url,
    authorExternalId: p.author_id ?? null,
    authorDisplay: p.author_name ?? null,
    title: p.author_name ? `${p.author_name} on Facebook` : null,
    content: excerpt(p.message, 4000),
    publishedAt,
    engagement: engagementOf({ reactions, comments, shares }),
    engagementScore: sum([reactions, comments, shares]),
    linkedUrl: canonicalLink(p.external_url),
    matchText: p.message ?? "",
    mentionType: "post",
    dataProvider: "apidirect",
  };
}

export function normalizeFacebookComment(c: FacebookComment, parent: ExpansionParent): CandidateMention | null {
  const publishedAt = parseApiDate(c.date, c.timestamp);
  if (!publishedAt || !c.comment_id || !c.message) return null;
  const reactions = num(c.reactions_count);
  return {
    externalId: `comment:${c.comment_id}`,
    sourceUrl: parent.sourceUrl,
    parentExternalId: parent.externalId,
    authorExternalId: c.author_id ?? null,
    authorDisplay: c.author_name ?? null,
    title: "Comment on a Facebook post",
    content: excerpt(c.message, 2000),
    publishedAt,
    engagement: engagementOf({ reactions, replies: c.replies_count }),
    engagementScore: sum([reactions, c.replies_count]),
    matchText: c.message,
    contextText: parent.title,
    mentionType: "comment",
    collectionMethod: "comment_expansion",
    linkTarget: "thread",
    dataProvider: "apidirect",
  };
}

// ------------------------------------------------------------------ Substack

export function normalizeSubstackPost(p: SubstackPost): CandidateMention | null {
  const publishedAt = parseApiDate(p.date);
  const id = p.post_id != null ? String(p.post_id) : canonicalLink(p.url);
  if (!publishedAt || !id) return null;
  const likes = num(p.likes);
  const comments = num(p.comments);
  const restacks = num(p.restacks);
  return {
    externalId: `post:${id}`,
    sourceUrl: p.url,
    authorExternalId: p.author || null,
    authorDisplay: p.author_name || p.author || p.publication || null,
    title: p.title ?? null,
    // The API returns the description/preview, not the article body.
    content: excerpt(join(p.subtitle, p.snippet), 2000),
    language: p.lang ?? null,
    publishedAt,
    engagement: engagementOf({ likes, comments, restacks }),
    engagementScore: sum([likes, comments, restacks]),
    matchText: join(p.title, p.subtitle, p.snippet),
    community: p.publication ?? null,
    mentionType: "article",
    dataProvider: "apidirect",
  };
}

export function normalizeSubstackNote(n: SubstackNote): CandidateMention | null {
  const publishedAt = parseApiDate(n.date);
  if (!publishedAt || n.note_id == null) return null;
  const likes = num(n.likes);
  const replies = num(n.replies);
  const restacks = num(n.restacks);
  return {
    externalId: `note:${n.note_id}`,
    sourceUrl: n.url,
    authorExternalId: n.author_id != null ? String(n.author_id) : n.author ?? null,
    authorDisplay: n.author_name ?? n.author ?? null,
    title: n.author_name ? `Note by ${n.author_name}` : "Substack note",
    content: excerpt(n.body, 2000),
    language: n.lang ?? null,
    publishedAt,
    engagement: engagementOf({ likes, replies, restacks }),
    engagementScore: sum([likes, replies, restacks]),
    matchText: n.body ?? "",
    community: n.publication ?? null,
    mentionType: "note",
    dataProvider: "apidirect",
  };
}

// ------------------------------------------------------------------ Web & News

function sameSite(url: string, domain: string | null | undefined): boolean {
  if (!domain) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const d = domain.toLowerCase().replace(/^www\./, "");
    return host === d || host.endsWith(`.${d}`);
  } catch {
    return false;
  }
}

/**
 * Web results have no publication date, so discovery time is stored and the row
 * is flagged; analytics leave these out of time series. The product's own
 * website is not a mention of it.
 */
export function normalizeWebResult(r: WebResult, now: Date, ownDomain?: string | null): CandidateMention | null {
  const key = canonicalLink(r.url);
  if (!key || sameSite(r.url, ownDomain)) return null;
  return {
    externalId: `url:${sha(key, 40)}`,
    sourceUrl: r.url,
    title: r.title ?? null,
    // A search snippet, not the page's text.
    content: excerpt(r.snippet, 600),
    publishedAt: now,
    publishedAtEstimated: true,
    engagement: {},
    engagementScore: 0,
    linkedUrl: key,
    matchText: join(r.title, r.snippet, r.url),
    community: r.domain ?? r.source ?? null,
    mentionType: "article",
    dataProvider: "apidirect",
  };
}

/** Normalized headline key: syndicated copies of one story share it and are linked as reposts. */
export function headlineKey(title: string | null | undefined): string | null {
  if (!title) return null;
  const norm = title.toLowerCase().normalize("NFKC").replace(/\s[-|–—]\s[^-|–—]{2,60}$/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return norm.length >= 20 ? `headline:${sha(norm, 40)}` : null;
}

export function normalizeNewsArticle(a: NewsArticle, ownDomain?: string | null): CandidateMention | null {
  const key = canonicalLink(a.url);
  const publishedAt = parseApiDate(a.published_datetime_utc);
  if (!key || !publishedAt || sameSite(a.url, ownDomain)) return null;
  return {
    externalId: `url:${sha(key, 40)}`,
    sourceUrl: a.url,
    authorExternalId: null,
    authorDisplay: a.authors?.length ? a.authors.slice(0, 3).join(", ") : a.source_name ?? null,
    title: a.title ?? null,
    content: excerpt(a.snippet, 600),
    publishedAt,
    engagement: {},
    engagementScore: 0,
    linkedUrl: headlineKey(a.title),
    matchText: join(a.title, a.snippet),
    community: a.source_name ?? a.domain ?? null,
    mentionType: "article",
    dataProvider: "apidirect",
  };
}

// ------------------------------------------------------------------ Trustpilot

export function normalizeTrustpilotReview(r: TrustpilotReview, domain: string): CandidateMention | null {
  const publishedAt = parseApiDate(r.review_datetime_utc, r.review_timestamp);
  const link = r.review_link ? httpsUrl(r.review_link) : null;
  if (!publishedAt || !r.review_id) return null;
  const useful = num(r.like_count);
  return {
    externalId: `review:${r.review_id}`,
    sourceUrl: link ?? `https://www.trustpilot.com/review/${encodeURIComponent(domain)}`,
    authorExternalId: r.author_id ?? null,
    authorDisplay: r.author_name ?? null,
    title: r.title ?? (typeof r.rating === "number" ? `${r.rating}-star review` : "Trustpilot review"),
    content: excerpt(r.review_text, 4000),
    language: r.review_language ?? null,
    publishedAt,
    engagement: engagementOf({ rating: r.rating, useful }),
    engagementScore: sum([useful]),
    matchText: join(r.title, r.review_text),
    mentionType: "review",
    collectionMethod: "review_feed",
    linkTarget: link ? "item" : "listing",
    dataProvider: "apidirect",
    directlyAbout: { reason: `Trustpilot review of ${domain}`, score: 0.95 },
  };
}
