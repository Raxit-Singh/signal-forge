// Google Play reviews through the official Play Developer API (reviews.list),
// read with a service account the customer creates in their own Play Console.
// The API returns reviews with comments from about the last week only, so
// history starts when the account is connected. Read-only scope.

import { createSign } from "node:crypto";
import { CAPS } from "./capabilities.ts";
import { SourceError } from "./errors.ts";
import type { CandidateMention, SourceAdapter } from "./types.ts";

export const PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";

export interface ServiceAccountKey { client_email: string; private_key: string; token_uri: string }

/** Parses and checks a pasted service-account JSON key (only the fields used). */
export function parseServiceAccount(json: string): ServiceAccountKey {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SourceError("bad_request", "That isn't valid JSON. Paste the whole key file you downloaded from Google Cloud.");
  }
  const k = raw as Record<string, unknown>;
  if (k.type !== "service_account") throw new SourceError("bad_request", "This is not a service account key (\"type\" must be \"service_account\").");
  if (typeof k.client_email !== "string" || !/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(k.client_email)) {
    throw new SourceError("bad_request", "The key has no valid service account email.");
  }
  if (typeof k.private_key !== "string" || !k.private_key.includes("PRIVATE KEY")) throw new SourceError("bad_request", "The key has no private key.");
  const tokenUri = typeof k.token_uri === "string" ? k.token_uri : "https://oauth2.googleapis.com/token";
  if (tokenUri !== "https://oauth2.googleapis.com/token") throw new SourceError("bad_request", "Unexpected token address in the key.");
  return { client_email: k.client_email, private_key: k.private_key, token_uri: tokenUri };
}

/** Package name from a play.google.com URL (`?id=com.example.app`). */
export function playPackage(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname !== "play.google.com") return null;
    const id = u.searchParams.get("id");
    return id && /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** RS256 JWT assertion for the OAuth 2.0 JWT bearer grant (service accounts). */
export function serviceAccountAssertion(key: ServiceAccountKey, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: key.client_email, scope: PLAY_SCOPE, aud: key.token_uri, iat, exp: iat + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  let sig: string;
  try {
    sig = signer.sign(key.private_key).toString("base64url");
  } catch {
    throw new SourceError("auth", "The service account's private key can't be used. Create a new key and connect again.");
  }
  return `${header}.${claims}.${sig}`;
}

type Fetch = typeof fetch;

export async function accessToken(key: ServiceAccountKey, fetchImpl: Fetch = fetch): Promise<string> {
  const res = await fetchImpl(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceAccountAssertion(key) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 400 || res.status === 401) throw new SourceError("auth", "Google rejected the service account key (it may have been deleted or disabled).");
  if (!res.ok) throw new SourceError("transient", `Google sign-in failed (${res.status}).`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new SourceError("transient", "Google sign-in returned no token.");
  return body.access_token;
}

export interface PlayReview {
  reviewId?: string;
  authorName?: string;
  comments?: Array<{ userComment?: { text?: string; lastModified?: { seconds?: string | number }; starRating?: number; reviewerLanguage?: string; appVersionName?: string; thumbsUpCount?: number; device?: string } }>;
}

export function normalizePlayReview(r: PlayReview, pkg: string, appName: string): CandidateMention | null {
  const c = r.comments?.find((x) => x.userComment)?.userComment;
  const seconds = Number(c?.lastModified?.seconds);
  if (!r.reviewId || !c || !Number.isFinite(seconds)) return null;
  const text = (c.text ?? "").replace(/\t/g, " ").trim();
  const rating = Number(c.starRating ?? 0);
  return {
    externalId: `review:${r.reviewId}`,
    sourceUrl: `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&reviewId=${encodeURIComponent(r.reviewId)}`,
    authorDisplay: r.authorName ?? null,
    authorExternalId: null, // Play doesn't expose a reviewer id; reviews aren't attributed across posts
    title: rating ? `${rating}-star review` : "Review",
    content: text.slice(0, 4000),
    language: c.reviewerLanguage ?? null,
    publishedAt: new Date(seconds * 1000),
    engagement: { rating, helpful: Number(c.thumbsUpCount ?? 0) },
    engagementScore: Number(c.thumbsUpCount ?? 0),
    matchText: text,
    mentionType: "review",
    collectionMethod: "review_feed",
    linkTarget: "item",
    directlyAbout: { reason: `Google Play review of ${appName}`, score: 0.95 },
  };
}

export function createGooglePlayAdapter(fetchImpl: Fetch = fetch): SourceAdapter {
  return {
    id: "google_play",
    name: "Google Play",
    dataProvider: "official",
    requiresConnection: true,
    streams: [{ id: "reviews", label: "Reviews of your app", mentionType: "review", capabilities: CAPS.googlePlayReviews, queryMode: "product" }],
    configured: () => ({ ok: true }),
    rateLimit: () => ({ key: "google_play", capacity: 20, refillPerSecond: 1 }),

    async searchMentions(req, ctx) {
      const pkg = req.target?.playPackage;
      const secret = req.target?.connection?.secret;
      if (!pkg) throw new SourceError("bad_request", "No Google Play URL set for this product.");
      if (!secret) throw new SourceError("auth", "Google Play isn't connected for this workspace.");
      const token = await accessToken(parseServiceAccount(secret), fetchImpl);
      const items: CandidateMention[] = [];
      let pageToken: string | undefined;
      let pages = 0;
      let reached = false;
      do {
        const q = new URLSearchParams({ maxResults: "100" });
        if (pageToken) q.set("token", pageToken);
        const res = await ctx.request({
          url: `${API}/applications/${encodeURIComponent(pkg)}/reviews?${q}`, endpoint: "reviews",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: req.signal,
        });
        if (res.status === 401 || res.status === 403) throw new SourceError("auth", "The service account can't read this app's reviews. In Play Console, give it access to the app (View app information).");
        if (res.status === 404) throw new SourceError("bad_request", `Google Play has no app ${pkg} in this account.`);
        if (res.status === 429) throw new SourceError("rate_limited", "Google Play is rate limiting requests.");
        if (!res.ok) throw new SourceError("transient", `Google Play request failed (${res.status}).`);
        const body = (await res.json()) as { reviews?: PlayReview[]; tokenPagination?: { nextPageToken?: string } };
        pages++;
        const got = (body.reviews ?? []).map((r) => normalizePlayReview(r, pkg, req.terms[0] ?? "your app")).filter((x): x is CandidateMention => x !== null);
        items.push(...got);
        pageToken = body.tokenPagination?.nextPageToken;
        if (!pageToken || got.length === 0 || Math.min(...got.map((g) => g.publishedAt.getTime())) < req.window.since.getTime()) {
          reached = true;
          break;
        }
      } while (pages < Math.min(CAPS.googlePlayReviews.maxPagesPerRun, req.maxPages));
      return {
        items: items.filter((i) => i.publishedAt >= req.window.since && i.publishedAt < req.window.until),
        complete: reached, saturated: !reached, pagesRequested: pages,
        incompleteReason: reached ? undefined : "More Google Play reviews than one check reads; the rest are read next time.",
      };
    },

    async validateCredentials() {},
  };
}
