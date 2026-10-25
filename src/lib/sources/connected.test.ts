// Connected sources (Google Play) against recorded-shape responses: no
// network, no real credentials. Not validated against the live APIs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";

import { SourceError } from "./errors.ts";
import { createGooglePlayAdapter, parseServiceAccount, playPackage, serviceAccountAssertion, PLAY_SCOPE } from "./google-play.ts";
import { buildQueryGroups, resolveEnablement } from "./query-groups.ts";
import { createAdapters } from "./registry.ts";
import type { SourceContext, SourceRequest } from "./types.ts";

const WINDOW = { since: new Date("2026-10-10T00:00:00Z"), until: new Date("2026-10-17T00:00:00Z") };

function ctxWith(handler: (u: URL, r: SourceRequest) => Response) {
  const calls: SourceRequest[] = [];
  const ctx: SourceContext = {
    async request(req) {
      calls.push(req);
      return handler(new URL(req.url), req);
    },
    async cooldown() {},
    async paidRequest() {
      throw new Error("no paid requests");
    },
    now: () => WINDOW.until,
  };
  return { ctx, calls };
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_JSON = JSON.stringify({
  type: "service_account", client_email: "signalforge-reader@acme-play.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), token_uri: "https://oauth2.googleapis.com/token",
});

test("Google Play: key checks, package from URL, signed assertion with the read-only scope", () => {
  assert.equal(playPackage("https://play.google.com/store/apps/details?id=com.acme.app&hl=en"), "com.acme.app");
  assert.equal(playPackage("https://evil.example/?id=com.acme.app"), null);
  assert.equal(playPackage("https://play.google.com/store/apps/details?id=nodots"), null);
  assert.throws(() => parseServiceAccount("{"), (e) => e instanceof SourceError && /valid JSON/.test(e.message));
  assert.throws(() => parseServiceAccount(JSON.stringify({ type: "authorized_user" })), /service account/);
  assert.throws(() => parseServiceAccount(JSON.stringify({ ...JSON.parse(KEY_JSON), token_uri: "https://evil.example/token" })), /token address/);
  const key = parseServiceAccount(KEY_JSON);
  const jwt = serviceAccountAssertion(key, Date.parse("2026-10-17T00:00:00Z"));
  const [h, c, sig] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(c!, "base64url").toString());
  assert.equal(claims.scope, PLAY_SCOPE);
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  assert.equal(claims.exp - claims.iat, 3600);
  const v = createVerify("RSA-SHA256");
  v.update(`${h}.${c}`);
  assert.ok(v.verify(publicKey, Buffer.from(sig!, "base64url")), "RS256 signature verifies with the key's public half");
});

test("Google Play: token exchange then reviews.list pages until the window; reviews link to themselves", async () => {
  const posted: Array<{ url: string; body: string }> = [];
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    posted.push({ url: String(url), body: String(init?.body) });
    return Response.json({ access_token: "ya29.test", expires_in: 3600 });
  }) as typeof fetch;
  const t = (iso: string) => ({ seconds: String(Date.parse(iso) / 1000) });
  const { ctx, calls } = ctxWith((u) => {
    assert.match(u.pathname, /\/applications\/com\.acme\.app\/reviews$/);
    if (!u.searchParams.get("token")) {
      return Response.json({
        reviews: [
          { reviewId: "r1", authorName: "Ann", comments: [{ userComment: { text: "Crashes on login", lastModified: t("2026-10-16T10:00:00Z"), starRating: 1, thumbsUpCount: 3 } }] },
          { reviewId: "r2", authorName: "Bo", comments: [{ developerComment: {} }] },
        ],
        tokenPagination: { nextPageToken: "p2" },
      });
    }
    return Response.json({ reviews: [{ reviewId: "r3", comments: [{ userComment: { text: "Old", lastModified: t("2026-10-01T00:00:00Z"), starRating: 4 } }] }] });
  });
  const r = await createGooglePlayAdapter(fakeFetch).searchMentions({
    terms: ["Acme"], window: WINDOW, maxPages: 5, target: { playPackage: "com.acme.app", connection: { secret: KEY_JSON, config: {} } },
  }, ctx);
  assert.equal(posted.length, 1);
  assert.match(posted[0]!.body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
  assert.equal(calls[0]!.headers?.Authorization, "Bearer ya29.test");
  assert.equal(calls.length, 2);
  assert.equal(r.complete, true);
  assert.deepEqual(r.items.map((i) => i.externalId), ["review:r1"], "older than the window and comment-less entries are dropped");
  const i = r.items[0]!;
  assert.equal(i.sourceUrl, "https://play.google.com/store/apps/details?id=com.acme.app&reviewId=r1");
  assert.equal(i.title, "1-star review");
  assert.equal(i.mentionType, "review");
  assert.ok(i.directlyAbout, "reviews of the product's own app need no keyword match");
});

test("Google Play: missing access and rejected keys are permanent errors with a clear fix", async () => {
  const ok = (async () => Response.json({ access_token: "t" })) as typeof fetch;
  const denied = ctxWith(() => new Response("{}", { status: 403 }));
  await assert.rejects(createGooglePlayAdapter(ok).searchMentions({ terms: [], window: WINDOW, maxPages: 1, target: { playPackage: "com.acme.app", connection: { secret: KEY_JSON, config: {} } } }, denied.ctx),
    (e) => e instanceof SourceError && e.kind === "auth" && /Play Console/.test(e.message));
  const rejected = (async () => new Response("{}", { status: 400 })) as typeof fetch;
  await assert.rejects(createGooglePlayAdapter(rejected).searchMentions({ terms: [], window: WINDOW, maxPages: 1, target: { playPackage: "com.acme.app", connection: { secret: KEY_JSON, config: {} } } }, denied.ctx),
    (e) => e instanceof SourceError && e.kind === "auth");
  await assert.rejects(createGooglePlayAdapter(ok).searchMentions({ terms: [], window: WINDOW, maxPages: 1, target: { playPackage: "com.acme.app", connection: null } }, denied.ctx),
    (e) => e instanceof SourceError && e.kind === "auth");
});

test("planning: connected sources only run once connected, with one product search each", () => {
  const adapters = createAdapters({});
  const product = { id: "p1", workspace_id: "w", website_url: null, app_store_url: null, play_store_url: "https://play.google.com/store/apps/details?id=com.acme.app", archived_at: null };
  const off = resolveEnablement(adapters, product, new Map(), 0, false);
  assert.match(off.find((e) => e.id === "google_play")!.reason!, /Connect it/);
  const on = resolveEnablement(adapters, product, new Map(), 0, false, new Set(["google_play"]));
  assert.ok(on.find((e) => e.id === "google_play")!.enabled);
  const noUrl = resolveEnablement(adapters, { ...product, play_store_url: null }, new Map(), 0, false, new Set(["google_play"]));
  assert.match(noUrl.find((e) => e.id === "google_play")!.reason!, /Google Play URL/);
  const groups = buildQueryGroups(product, [], on, adapters, { planMaxSearches: 2, stackExchangeKey: false });
  assert.deepEqual(groups.filter((g) => g.provider === "google_play").map((g) => g.query), ["play:com.acme.app"]);
});
