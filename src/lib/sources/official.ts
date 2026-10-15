// Free official sources added in Milestone 2.5.
//
// Bluesky — AppView `app.bsky.feed.searchPosts` (docs.bsky.app). Unauthenticated
//   at api.bsky.app (checked 2026-10-15; public.api.bsky.app answers 403 for
//   search). Supports phrases, since/until, sort=latest, cursor; no OR, so one
//   query per keyword. Jetstream (the firehose) needs a long-running WebSocket
//   consumer, which this serverless deployment does not have; search is used
//   instead, and it does not promise complete historical coverage.
// DEV — Forem API v1 (developers.forem.com/api). There is no documented
//   full-text search, only tag feeds, so DEV finds articles *tagged* with a
//   keyword. Comments come from /api/comments for selected articles.
// App Store — Apple's public customer-reviews feed for the product's own app
//   (itunes.apple.com/{cc}/rss/customerreviews/...). Most recent reviews only.

import { SourceError, httpError } from "./errors.ts";
import { CAPS } from "./capabilities.ts";
import { canonicalLink, excerpt, htmlToText, sum } from "./text.ts";
import type { CandidateMention, ExpansionParent, SearchRequest, SearchResult, SourceAdapter, SourceContext } from "./types.ts";

const UA = { "User-Agent": "SignalForge/0.1 (social listening; contact via site)", Accept: "application/json" };

// ------------------------------------------------------------------ Bluesky

export interface BskyPost {
  uri: string;
  author?: { did?: string; handle?: string; displayName?: string };
  record?: { text?: string; createdAt?: string; langs?: string[]; reply?: { parent?: { uri?: string }; root?: { uri?: string } };
    embed?: { external?: { uri?: string; title?: string } } };
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  indexedAt?: string;
}

/** Web link for an at:// post URI. */
export function bskyPostUrl(uri: string, handle?: string): string | null {
  const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(uri);
  if (!m) return null;
  return `https://bsky.app/profile/${encodeURIComponent(handle || m[1]!)}/post/${encodeURIComponent(m[2]!)}`;
}

export function normalizeBskyPost(p: BskyPost): CandidateMention | null {
  const url = bskyPostUrl(p.uri, p.author?.handle);
  const created = p.record?.createdAt ? new Date(p.record.createdAt) : null;
  if (!url || !created || Number.isNaN(created.getTime())) return null;
  const text = p.record?.text ?? "";
  const isReply = Boolean(p.record?.reply);
  const ext = p.record?.embed?.external;
  return {
    externalId: p.uri,
    sourceUrl: url,
    parentExternalId: p.record?.reply?.parent?.uri ?? null,
    authorExternalId: p.author?.did ?? null,
    authorDisplay: p.author?.handle ? `@${p.author.handle}` : p.author?.displayName ?? null,
    title: p.author?.handle ? `@${p.author.handle} on Bluesky` : null,
    content: excerpt(text, 3000),
    language: p.record?.langs?.[0] ?? null,
    publishedAt: created,
    engagement: { likes: p.likeCount ?? 0, reposts: p.repostCount ?? 0, replies: p.replyCount ?? 0, quotes: p.quoteCount ?? 0 },
    engagementScore: sum([p.likeCount, p.repostCount, p.replyCount, p.quoteCount]),
    linkedUrl: canonicalLink(ext?.uri),
    matchText: [text, ext?.title, ext?.uri].filter(Boolean).join("\n"),
    mentionType: isReply ? "reply" : "post",
  };
}

export const bluesky: SourceAdapter = {
  id: "bluesky",
  name: "Bluesky",
  dataProvider: "official",
  shareable: true,
  streams: [{ id: "posts", label: "Posts and replies", mentionType: "post", capabilities: CAPS.blueskyPosts, queryMode: "keywords" }],
  configured: () => ({ ok: true }),
  rateLimit: () => ({ key: "bluesky", capacity: 10, refillPerSecond: 1 }),

  async searchMentions(req: SearchRequest, ctx: SourceContext): Promise<SearchResult> {
    const q = (req.query ?? req.terms[0] ?? "").trim();
    if (!q) throw new SourceError("bad_request", "Empty query");
    const items: CandidateMention[] = [];
    let cursor: string | undefined;
    let pages = 0;
    const max = Math.max(1, Math.min(CAPS.blueskyPosts.maxPagesPerRun, req.maxPages));
    do {
      const params = new URLSearchParams({
        q, sort: "latest", limit: "100", since: req.window.since.toISOString(), until: req.window.until.toISOString(),
      });
      if (cursor) params.set("cursor", cursor);
      const res = await ctx.request({ url: `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?${params}`, endpoint: "searchPosts", headers: UA, signal: req.signal });
      if (!res.ok) throw httpError("Bluesky", res);
      const body = (await res.json()) as { posts?: BskyPost[]; cursor?: string };
      pages++;
      for (const p of body.posts ?? []) {
        const m = normalizeBskyPost(p);
        if (m) items.push(m);
      }
      cursor = body.cursor && (body.posts?.length ?? 0) > 0 ? body.cursor : undefined;
    } while (cursor && pages < max);
    return {
      items, complete: !cursor, saturated: Boolean(cursor), pagesRequested: pages,
      incompleteReason: cursor ? `Bluesky had more than ${pages * 100} matching posts in the window; the newest were collected.` : undefined,
    };
  },

  async validateCredentials() {},
};

// ------------------------------------------------------------------ DEV (Forem)

export interface DevArticle {
  id: number;
  title?: string;
  description?: string;
  url?: string;
  published_at?: string;
  comments_count?: number;
  public_reactions_count?: number;
  tag_list?: string[] | string;
  canonical_url?: string;
  user?: { username?: string; name?: string };
}

export interface DevComment {
  id_code?: string;
  created_at?: string;
  body_html?: string;
  user?: { username?: string; name?: string };
  children?: DevComment[];
}

/** DEV tags are lowercase letters and digits. */
export function devTag(term: string): string | null {
  const t = term.toLowerCase().replace(/[^a-z0-9]/g, "");
  return t.length >= 3 && t.length <= 30 ? t : null;
}

export function normalizeDevArticle(a: DevArticle): CandidateMention | null {
  const published = a.published_at ? new Date(a.published_at) : null;
  if (!a.id || !a.url || !published || Number.isNaN(published.getTime())) return null;
  const tags = Array.isArray(a.tag_list) ? a.tag_list : (a.tag_list ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  return {
    externalId: `article:${a.id}`,
    sourceUrl: a.url,
    authorExternalId: a.user?.username ?? null,
    authorDisplay: a.user?.name ?? a.user?.username ?? null,
    title: a.title ?? null,
    content: excerpt(a.description, 1000),
    publishedAt: published,
    engagement: { reactions: a.public_reactions_count ?? 0, comments: a.comments_count ?? 0 },
    engagementScore: sum([a.public_reactions_count, a.comments_count]),
    linkedUrl: a.canonical_url && a.canonical_url !== a.url ? canonicalLink(a.canonical_url) : null,
    matchText: [a.title, a.description, tags.map((t) => `#${t}`).join(" ")].filter(Boolean).join("\n"),
    mentionType: "article",
    collectionMethod: "tag_feed",
  };
}

export function flattenDevComments(list: DevComment[], parent: ExpansionParent, out: CandidateMention[] = []): CandidateMention[] {
  for (const c of list) {
    const created = c.created_at ? new Date(c.created_at) : null;
    const text = htmlToText(c.body_html);
    if (c.id_code && created && !Number.isNaN(created.getTime()) && text && c.user?.username) {
      out.push({
        externalId: `comment:${c.id_code}`,
        sourceUrl: `https://dev.to/${encodeURIComponent(c.user.username)}/comment/${encodeURIComponent(c.id_code)}`,
        parentExternalId: parent.externalId,
        authorExternalId: c.user.username,
        authorDisplay: c.user.name ?? c.user.username,
        title: parent.title ? `Comment on: ${parent.title}` : "DEV comment",
        content: excerpt(text, 2000),
        publishedAt: created,
        engagement: {},
        engagementScore: 0,
        matchText: text,
        contextText: parent.title,
        mentionType: "comment",
        collectionMethod: "comment_expansion",
      });
    }
    if (c.children?.length) flattenDevComments(c.children, parent, out);
  }
  return out;
}

export const dev: SourceAdapter = {
  id: "dev",
  name: "DEV Community",
  dataProvider: "official",
  shareable: true,
  streams: [{ id: "articles", label: "Articles tagged with a keyword", mentionType: "article", capabilities: CAPS.devArticles, queryMode: "keywords" }],
  configured: () => ({ ok: true }),
  rateLimit: () => ({ key: "dev", capacity: 10, refillPerSecond: 1 }),

  async searchMentions(req, ctx) {
    const tag = devTag(req.query ?? req.terms[0] ?? "");
    if (!tag) return { items: [], complete: true, pagesRequested: 0 };
    const res = await ctx.request({
      url: `https://dev.to/api/articles?${new URLSearchParams({ tag, per_page: "100", page: "1" })}`,
      endpoint: "articles", headers: { ...UA, Accept: "application/vnd.forem.api-v1+json" }, signal: req.signal,
    });
    if (!res.ok) throw httpError("DEV", res);
    const list = (await res.json()) as DevArticle[];
    const items = list.map(normalizeDevArticle).filter((x): x is CandidateMention => x !== null);
    const oldest = Math.min(...items.map((i) => i.publishedAt.getTime()));
    const reached = list.length < 100 || oldest < req.window.since.getTime();
    return {
      items: items.filter((i) => i.publishedAt >= req.window.since),
      complete: reached, saturated: !reached, pagesRequested: 1,
      incompleteReason: reached ? undefined : "More than 100 articles carry this tag in the window; the newest were collected.",
    };
  },

  async expandComments(parents, ctx, signal) {
    const items: CandidateMention[] = [];
    for (const p of parents) {
      const res = await ctx.request({
        url: `https://dev.to/api/comments?a_id=${encodeURIComponent(p.platformId)}`, endpoint: "comments",
        headers: { ...UA, Accept: "application/vnd.forem.api-v1+json" }, signal,
      });
      if (res.status === 404) continue;
      if (!res.ok) throw httpError("DEV", res);
      flattenDevComments((await res.json()) as DevComment[], p, items);
    }
    return { items, complete: false, pagesRequested: parents.length, incompleteReason: "Comments are read on selected articles only." };
  },

  async validateCredentials() {},
};

// ------------------------------------------------------------------ App Store

interface Label { label?: string }
export interface AppStoreEntry {
  id?: Label;
  author?: { name?: Label; uri?: Label };
  updated?: Label;
  title?: Label;
  content?: Label;
  "im:rating"?: Label;
  "im:version"?: Label;
  "im:voteSum"?: Label;
}

/** App id and storefront from an apps.apple.com URL. */
export function appStoreIds(url: string | null | undefined): { id: string; country: string } | null {
  if (!url) return null;
  const id = /\/id(\d{5,15})/.exec(url)?.[1];
  if (!id) return null;
  const country = /apps\.apple\.com\/([a-z]{2})\//i.exec(url)?.[1]?.toLowerCase() ?? "us";
  return { id, country };
}

export function normalizeAppStoreEntry(e: AppStoreEntry, listingUrl: string, appName: string): CandidateMention | null {
  const id = e.id?.label;
  const rating = Number(e["im:rating"]?.label);
  const at = e.updated?.label ? new Date(e.updated.label) : null;
  if (!id || !Number.isFinite(rating) || !at || Number.isNaN(at.getTime())) return null; // first entry can be app metadata
  const text = e.content?.label ?? "";
  const author = e.author?.name?.label ?? null;
  return {
    externalId: `review:${id}`,
    // The feed has no per-review link; the listing's reviews page is the closest public page.
    sourceUrl: listingUrl,
    authorExternalId: e.author?.uri?.label ?? author,
    authorDisplay: author,
    title: e.title?.label ?? `${rating}-star review`,
    content: excerpt(text, 4000),
    publishedAt: at,
    engagement: { rating, helpful: Number(e["im:voteSum"]?.label) || 0 },
    engagementScore: Number(e["im:voteSum"]?.label) || 0,
    matchText: `${e.title?.label ?? ""}\n${text}`,
    mentionType: "review",
    collectionMethod: "review_feed",
    linkTarget: "listing",
    directlyAbout: { reason: `App Store review of ${appName}`, score: 0.95 },
  };
}

export const appStore: SourceAdapter = {
  id: "app_store",
  name: "Apple App Store",
  dataProvider: "official",
  streams: [{ id: "reviews", label: "Reviews of your app", mentionType: "review", capabilities: CAPS.appStoreReviews, queryMode: "product" }],
  configured: () => ({ ok: true }),
  rateLimit: () => ({ key: "app_store", capacity: 10, refillPerSecond: 0.5 }),

  async searchMentions(req, ctx) {
    const appId = req.target?.appStoreId;
    if (!appId) throw new SourceError("bad_request", "No App Store URL set for this product.");
    const cc = req.target?.appStoreCountry ?? "us";
    const listing = `https://apps.apple.com/${cc}/app/id${appId}?see-all=reviews`;
    const items: CandidateMention[] = [];
    let pages = 0;
    let reached = false;
    for (let page = 1; page <= Math.min(CAPS.appStoreReviews.maxPagesPerRun, req.maxPages); page++) {
      const res = await ctx.request({
        url: `https://itunes.apple.com/${cc}/rss/customerreviews/page=${page}/id=${appId}/sortby=mostrecent/json`,
        endpoint: "customerreviews", headers: UA, signal: req.signal,
      });
      if (!res.ok) throw httpError("App Store", res);
      const body = (await res.json()) as { feed?: { entry?: AppStoreEntry[] | AppStoreEntry } };
      pages++;
      const raw = body.feed?.entry;
      const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const got = entries.map((e) => normalizeAppStoreEntry(e, listing, req.terms[0] ?? "your app")).filter((x): x is CandidateMention => x !== null);
      items.push(...got);
      if (got.length === 0 || Math.min(...got.map((g) => g.publishedAt.getTime())) < req.window.since.getTime()) {
        reached = true;
        break;
      }
    }
    return {
      items: items.filter((i) => i.publishedAt >= req.window.since), complete: reached, saturated: !reached, pagesRequested: pages,
      incompleteReason: reached ? undefined : "Apple's feed was read to its page limit; older reviews in the window may remain.",
    };
  },

  async validateCredentials() {},
};
