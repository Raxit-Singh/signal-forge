// API Direct endpoint catalog: paths, parameters, pagination and billing units,
// transcribed from the official docs (github.com/joshwallerr/apidirect-docs,
// mirrored at apidirect.io/docs, read 2026-10-15). Prices are NOT here: the
// `provider_pricing` table is the single source of truth for money.

import type { PaidSourceId } from "../types.ts";

export type ParamSpec =
  | { type: "string"; max: number; required?: boolean }
  | { type: "enum"; values: readonly string[]; required?: boolean }
  | { type: "int"; min: number; max: number; required?: boolean }
  | { type: "date"; required?: boolean }; // YYYY-MM-DD (UTC)

export interface EndpointSpec {
  /** Key in `provider_pricing`. */
  pricingKey: string;
  platform: PaidSourceId;
  path: string;
  /** "pages": billed per page requested (`pages=N` costs N); "request": one charge per call. */
  billing: "pages" | "request";
  /** Field of the response that holds the result list. */
  listField: string;
  params: Record<string, ParamSpec>;
}

const query = { type: "string", max: 500, required: true } as const;

export const ENDPOINTS = {
  redditPosts: {
    pricingKey: "reddit.posts", platform: "reddit", path: "/v1/reddit/posts", billing: "request", listField: "posts",
    params: {
      query,
      page: { type: "int", min: 1, max: 12 },
      sort_by: { type: "enum", values: ["most_recent", "relevance", "hot", "top"] },
      posted_ago: { type: "enum", values: ["1h", "24h", "7d", "30d", "12m"] },
    },
  },
  redditComments: {
    pricingKey: "reddit.comments", platform: "reddit", path: "/v1/reddit/comments", billing: "pages", listField: "posts",
    params: {
      query,
      pages: { type: "int", min: 1, max: 10 },
      sort_by: { type: "enum", values: ["most_recent", "relevance", "top"] },
    },
  },
  xPosts: {
    pricingKey: "x.posts", platform: "x", path: "/v1/twitter/posts", billing: "pages", listField: "posts",
    params: {
      query,
      pages: { type: "int", min: 1, max: 20 },
      sort_by: { type: "enum", values: ["most_recent", "relevance"] },
      posted_ago: { type: "enum", values: ["1h", "24h", "7d", "30d", "12m"] },
      start_date: { type: "date" },
      end_date: { type: "date" },
    },
  },
  xTweetComments: {
    pricingKey: "x.tweet_comments", platform: "x", path: "/v1/twitter/tweet/comments", billing: "pages", listField: "comments",
    params: { tweet_id: { type: "string", max: 30, required: true }, pages: { type: "int", min: 1, max: 20 } },
  },
  xTweetQuotes: {
    pricingKey: "x.tweet_quotes", platform: "x", path: "/v1/twitter/tweet/quotes", billing: "pages", listField: "quotes",
    params: { tweet_id: { type: "string", max: 30, required: true }, pages: { type: "int", min: 1, max: 20 } },
  },
  linkedinPosts: {
    pricingKey: "linkedin.posts", platform: "linkedin", path: "/v1/linkedin/posts", billing: "request", listField: "posts",
    params: {
      query,
      page: { type: "int", min: 1, max: 25 },
      sort_by: { type: "enum", values: ["most_recent", "relevance"] },
      posted_ago: { type: "enum", values: ["24h", "7d", "30d"] },
    },
  },
  tiktokVideos: {
    pricingKey: "tiktok.videos", platform: "tiktok", path: "/v1/tiktok/videos", billing: "pages", listField: "videos",
    params: {
      query,
      pages: { type: "int", min: 1, max: 10 },
      region: { type: "string", max: 2 },
      publish_time: { type: "enum", values: ["0", "1", "7", "30", "90", "180"] },
      sort_by: { type: "enum", values: ["relevance", "most_recent", "most_liked"] },
    },
  },
  tiktokVideoComments: {
    pricingKey: "tiktok.video_comments", platform: "tiktok", path: "/v1/tiktok/video/comments", billing: "pages", listField: "comments",
    params: { video_id: { type: "string", max: 30, required: true }, pages: { type: "int", min: 1, max: 1000 } },
  },
  instagramPosts: {
    pricingKey: "instagram.posts", platform: "instagram", path: "/v1/instagram/posts", billing: "pages", listField: "posts",
    params: { query, pages: { type: "int", min: 1, max: 20 } },
  },
  instagramPostComments: {
    pricingKey: "instagram.post_comments", platform: "instagram", path: "/v1/instagram/post/comments", billing: "pages", listField: "comments",
    params: {
      code: { type: "string", max: 50, required: true },
      pages: { type: "int", min: 1, max: 20 },
      sort_by: { type: "enum", values: ["popular", "recent"] },
    },
  },
  facebookPosts: {
    pricingKey: "facebook.posts", platform: "facebook", path: "/v1/facebook/posts", billing: "pages", listField: "posts",
    params: {
      query,
      pages: { type: "int", min: 1, max: 15 },
      start_date: { type: "date" },
      end_date: { type: "date" },
      sort_by: { type: "enum", values: ["most_recent", "relevance"] },
    },
  },
  facebookPostComments: {
    pricingKey: "facebook.post_comments", platform: "facebook", path: "/v1/facebook/post/comments", billing: "pages", listField: "comments",
    params: { post_id: { type: "string", max: 200, required: true }, pages: { type: "int", min: 1, max: 20 } },
  },
  substackPosts: {
    pricingKey: "substack.posts", platform: "substack", path: "/v1/substack/posts", billing: "request", listField: "posts",
    params: {
      query,
      page: { type: "int", min: 1, max: 101 },
      posted_ago: { type: "enum", values: ["24h", "7d", "30d", "12m"] },
      language: { type: "string", max: 2 },
    },
  },
  substackNotes: {
    pricingKey: "substack.notes", platform: "substack", path: "/v1/substack/notes", billing: "pages", listField: "notes",
    params: { query, sort_by: { type: "enum", values: ["most_recent", "top"] }, pages: { type: "int", min: 1, max: 250 } },
  },
  webSearch: {
    pricingKey: "web.search", platform: "web", path: "/v1/web/search", billing: "pages", listField: "results",
    params: {
      query,
      pages: { type: "int", min: 1, max: 10 },
      country: { type: "string", max: 2 },
      language: { type: "string", max: 2 },
      time: { type: "enum", values: ["any", "hour", "day", "week", "month", "year"] },
    },
  },
  newsArticles: {
    pricingKey: "news.articles", platform: "news", path: "/v1/news/articles", billing: "request", listField: "articles",
    params: {
      query,
      limit: { type: "int", min: 1, max: 100 },
      time_published: { type: "enum", values: ["anytime", "1h", "1d", "7d", "1y"] },
      country: { type: "string", max: 2 },
      language: { type: "string", max: 2 },
    },
  },
  trustpilotReviews: {
    pricingKey: "trustpilot.company_reviews", platform: "trustpilot", path: "/v1/trustpilot/company/reviews", billing: "pages", listField: "reviews",
    params: {
      domain: { type: "string", max: 500, required: true },
      pages: { type: "int", min: 1, max: 10 },
      sort_by: { type: "enum", values: ["most_relevant", "newest"] },
      posted_ago: { type: "enum", values: ["30d", "3m", "6m", "12m"] },
      language: { type: "string", max: 2 },
      query: { type: "string", max: 500 },
    },
  },
} as const satisfies Record<string, EndpointSpec>;

export type EndpointName = keyof typeof ENDPOINTS;

/** Search endpoint of each paid platform stream ("platform/stream"), for cost estimates. */
export const STREAM_ENDPOINTS: Record<string, EndpointSpec> = {
  "reddit/posts": ENDPOINTS.redditPosts, "reddit/comments": ENDPOINTS.redditComments, "x/posts": ENDPOINTS.xPosts,
  "linkedin/posts": ENDPOINTS.linkedinPosts, "tiktok/videos": ENDPOINTS.tiktokVideos, "instagram/posts": ENDPOINTS.instagramPosts,
  "facebook/posts": ENDPOINTS.facebookPosts, "substack/posts": ENDPOINTS.substackPosts, "substack/notes": ENDPOINTS.substackNotes,
  "web/results": ENDPOINTS.webSearch, "news/articles": ENDPOINTS.newsArticles, "trustpilot/reviews": ENDPOINTS.trustpilotReviews,
};
export type Params = Record<string, string | number | undefined>;

/** Validates parameters against the spec; throws on anything the docs don't allow. */
export function validateParams(spec: EndpointSpec, params: Params): URLSearchParams {
  const out = new URLSearchParams();
  for (const key of Object.keys(params)) {
    if (params[key] !== undefined && !(key in spec.params)) throw new Error(`${spec.path}: unknown parameter "${key}"`);
  }
  for (const [key, p] of Object.entries(spec.params)) {
    const v = params[key];
    if (v === undefined || v === "") {
      if (p.required) throw new Error(`${spec.path}: "${key}" is required`);
      continue;
    }
    const s = String(v);
    switch (p.type) {
      case "string":
        if (s.trim().length === 0 || s.length > p.max) throw new Error(`${spec.path}: "${key}" must be 1-${p.max} characters`);
        break;
      case "enum":
        if (!p.values.includes(s)) throw new Error(`${spec.path}: "${key}" must be one of ${p.values.join(", ")}`);
        break;
      case "int": {
        const n = Number(v);
        if (!Number.isInteger(n) || n < p.min || n > p.max) throw new Error(`${spec.path}: "${key}" must be an integer ${p.min}-${p.max}`);
        break;
      }
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${spec.path}: "${key}" must be YYYY-MM-DD`);
        break;
    }
    out.set(key, s);
  }
  return out;
}

/** Units the provider bills for this call if it is answered. */
export function unitsRequested(spec: EndpointSpec, params: Params): number {
  if (spec.billing === "request") return 1;
  const pages = Number(params.pages ?? 1);
  return Number.isInteger(pages) && pages > 0 ? pages : 1;
}

/**
 * Billing rules (docs: Pricing → "How Billing Works", read 2026-10-15):
 *   - answered requests are billed: every 2xx (including zero results) and 404;
 *     multi-page endpoints bill per page *requested*
 *   - 404s, Instagram 403 private/limited account and Instagram-rejected post
 *     codes are billed as one request whatever `pages` was
 *   - other 4xx/5xx are not billed
 */
export function billedUnits(spec: EndpointSpec, status: number, code: string | null | undefined, requested: number): number {
  if (status >= 200 && status < 300) return requested;
  if (status === 404) return 1;
  if (spec.platform === "instagram") {
    if (status === 403 && (code === "private_account" || code === "limited_account")) return 1;
    // The exact code for "Instagram rejected the post code" isn't documented; count it to stay conservative.
    if (status === 400 && code !== "missing_parameter" && spec.path.includes("/post/")) return 1;
  }
  return 0;
}
