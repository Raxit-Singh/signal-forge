// TikHub client + search against mock responses shaped like the live ones
// (2026-10-22). No network, no paid calls.
import { test } from "node:test";
import assert from "node:assert/strict";

import { SourceError } from "../errors.ts";
import type { BillingIntent, BillingOutcome, PaidSourceId, SourceAdapter, SourceContext, SourceRequest } from "../types.ts";
import { tikhubError } from "./client.ts";
import { createTikhubSearch, tikhubPlatforms, tiktokPublishTime, withTikhubSearch, xQuery } from "./adapters.ts";
import { instagramMediaIn, normalizeTikhubInstagram, normalizeTikhubTiktok, normalizeTikhubTweet } from "./normalizers.ts";

const NOW = new Date("2026-10-22T12:00:00Z");
const WINDOW = { since: new Date("2026-10-21T00:00:00Z"), until: NOW };
const KEY = "th_test_not_real";

interface Call { url: URL; headers: Record<string, string>; billing: BillingIntent; outcome?: BillingOutcome }

function paidCtx(routes: Array<(u: URL) => { status: number; body: unknown } | undefined>) {
  const calls: Call[] = [];
  const ctx: SourceContext = {
    async request() { throw new Error("TikHub must only use paidRequest"); },
    async paidRequest(req: SourceRequest & { billing: BillingIntent }) {
      const url = new URL(req.url);
      const call: Call = { url, headers: req.headers ?? {}, billing: req.billing };
      calls.push(call);
      for (const r of routes) {
        const hit = r(url);
        if (hit) {
          return {
            response: new Response(JSON.stringify(hit.body), { status: hit.status }),
            ledgerId: `ledger-${calls.length}`,
            settle: async (o: BillingOutcome) => { assert.equal(call.outcome, undefined, "settled twice"); call.outcome = o; },
          };
        }
      }
      throw new Error(`unexpected ${req.url}`);
    },
    async cooldown() {},
    now: () => NOW,
  };
  return { ctx, calls };
}

const tweet = (id: string, at: string, text = "toing app was late again") => ({
  type: "tweet", tweet_id: id, screen_name: "someone", created_at: at, text, lang: "en",
  favorites: 3, retweets: 1, replies: 2, quotes: 0, bookmarks: 0, views: "120", conversation_id: id,
});

test("X: the window becomes search operators; tweets keep API Direct's ids", () => {
  assert.equal(xQuery({ terms: ["toing", "toing app"], window: WINDOW, maxPages: 1 }), 'toing OR "toing app" since:2026-10-21 until:2026-10-23');
  const m = normalizeTikhubTweet(tweet("1980000000000000001", "Wed Oct 22 08:00:00 +0000 2026"))!;
  assert.equal(m.externalId, "tweet:1980000000000000001");
  assert.equal(m.sourceUrl, "https://x.com/someone/status/1980000000000000001");
  assert.equal(m.dataProvider, "tikhub");
  assert.deepEqual(m.engagement, { likes: 3, retweets: 1, replies: 2, quotes: 0, bookmarks: 0, views: 120 });
  assert.equal(normalizeTikhubTweet({ ...tweet("1", "x"), type: "user" }), null);
  assert.equal(normalizeTikhubTweet({ ...tweet("1980000000000000002", "Wed Oct 22 08:00:00 +0000 2026"), conversation_id: "1979" })!.mentionType, "reply");
});

test("X search follows the cursor, bills one unit per answered call and stops when a page adds nothing", async () => {
  let page = 0;
  const { ctx, calls } = paidCtx([(u) => {
    if (!u.pathname.endsWith("/fetch_search_timeline")) return undefined;
    page++;
    if (page === 1) return { status: 200, body: { code: 200, data: { timeline: [tweet("1980000000000000001", "Wed Oct 22 08:00:00 +0000 2026"), tweet("1970000000000000001", "Mon Oct 13 08:00:00 +0000 2026")], next_cursor: "C2" } } };
    return { status: 200, body: { code: 200, data: { timeline: [tweet("1980000000000000001", "Wed Oct 22 08:00:00 +0000 2026")], next_cursor: "C3" } } };
  }]);
  const r = await createTikhubSearch(KEY).x!({ terms: ["toing"], window: WINDOW, maxPages: 5 }, ctx);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.headers.Authorization, `Bearer ${KEY}`);
  assert.ok(!calls[0]!.url.toString().includes(KEY), "key never in the URL");
  assert.equal(calls[1]!.url.searchParams.get("cursor"), "C2");
  assert.deepEqual(calls.map((c) => [c.billing.pricingKey, c.billing.units, c.outcome?.billedUnits]), [["tikhub_x.search", 1, 1], ["tikhub_x.search", 1, 1]]);
  assert.deepEqual(r.items.map((i) => i.externalId), ["tweet:1980000000000000001"], "items outside the window are dropped");
  assert.equal(r.complete, true);
});

test("failed calls are settled at zero, the generic upstream failure is retried once, auth is not", async () => {
  const fail = { detail: { code: 400, message: "Request failed. Please retry. ... You won't be charged for this request." } };
  let n = 0;
  const { ctx, calls } = paidCtx([(u) => (u.pathname.endsWith("/fetch_search_timeline") ? (++n === 1 ? { status: 400, body: fail } : { status: 200, body: { code: 200, data: { timeline: [], next_cursor: "" } } }) : undefined)]);
  const r = await createTikhubSearch(KEY).x!({ terms: ["toing"], window: WINDOW, maxPages: 2 }, ctx);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.outcome?.billedUnits, 0);
  assert.equal(r.items.length, 0);
  assert.equal(tikhubError(401, null).kind, "auth");
  assert.equal(tikhubError(402, null).kind, "budget");
  assert.equal(tikhubError(429, null).kind, "rate_limited");
  assert.equal(tikhubError(400, fail).kind, "transient");
  assert.equal(tikhubError(422, { detail: "bad keyword" }).kind, "bad_request");
});

test("TikTok: publish-time preset from the window, offset paging, ads dropped, ids match API Direct", async () => {
  assert.equal(tiktokPublishTime(20 * 3_600_000), "1");
  assert.equal(tiktokPublishTime(6 * 86_400_000), "7");
  assert.equal(tiktokPublishTime(400 * 86_400_000), "0");
  const video = (id: string, t: number, ad = false) => ({
    aweme_info: { aweme_id: id, desc: "toing order review", create_time: t, is_ads: ad, author: { unique_id: "foodie", uid: "77" }, statistics: { play_count: 900, digg_count: 40, comment_count: 4, share_count: 1 } },
  });
  const t = Math.floor(new Date("2026-10-22T06:00:00Z").getTime() / 1000);
  const { ctx, calls } = paidCtx([(u) => (u.pathname.endsWith("/fetch_video_search_result")
    ? { status: 200, body: { code: 200, data: { search_item_list: u.searchParams.get("offset") === "0" ? [video("7600000000000000001", t), video("7600000000000000002", t, true)] : [], has_more: u.searchParams.get("offset") === "0" ? 1 : 0, cursor: 20 } } }
    : undefined)]);
  const r = await createTikhubSearch(KEY).tiktok!({ terms: ["toing"], window: WINDOW, maxPages: 3 }, ctx);
  assert.equal(calls[0]!.url.searchParams.get("publish_time"), "7", "a 36 h window needs the 7-day preset");
  assert.equal(calls[1]!.url.searchParams.get("offset"), "20");
  assert.deepEqual(r.items.map((i) => [i.externalId, i.sourceUrl]), [["video:7600000000000000001", "https://www.tiktok.com/@foodie/video/7600000000000000001"]]);
  assert.equal(r.complete, true);
  assert.equal(normalizeTikhubTiktok({}), null);
});

test("Instagram: media found inside nested sections, ids match API Direct, never claimed complete", () => {
  const media = { id: "3945667300468651610_123", code: "DbB04E2TvZa", taken_at: 1784580307, product_type: "clips", caption: { text: "@toing.it is the worst food delivery app" }, user: { username: "dev.drilling", id: "123" }, like_count: 115, comment_count: 63, ig_play_count: 12636 };
  const found = instagramMediaIn({ data: { sections: [{ layout_content: { medias: [{ media }] } }, { media }] } });
  assert.equal(found.length, 1, "same media listed twice is kept once");
  const m = normalizeTikhubInstagram(found[0]!)!;
  assert.equal(m.externalId, "media:3945667300468651610");
  assert.equal(m.sourceUrl, "https://www.instagram.com/reel/DbB04E2TvZa/");
  assert.deepEqual(m.engagement, { likes: 115, comments: 63, views: 12636 });
});

test("only x, tiktok and instagram can move to TikHub; search changes, the rest of the adapter stays", () => {
  assert.deepEqual(tikhubPlatforms(" X, tiktok ,reddit,instagram,bogus"), ["x", "tiktok", "instagram"]);
  const fake = (id: PaidSourceId): SourceAdapter => ({
    id, name: id, paid: true, dataProvider: "apidirect", shareable: true,
    streams: [{ id: "posts", label: "Posts", mentionType: "post", capabilities: { sortNewest: true } as never, queryMode: "keywords" }],
    configured: () => ({ ok: true }), rateLimit: () => ({ key: `apidirect:${id}`, capacity: 6, refillPerSecond: 2 }),
    searchMentions: async () => ({ items: [], complete: true }), expandComments: async () => ({ items: [], complete: true }),
    validateCredentials: async () => undefined,
  });
  const base = Object.fromEntries(["reddit", "x", "tiktok"].map((p) => [p, fake(p as PaidSourceId)])) as Record<PaidSourceId, SourceAdapter>;
  const out = withTikhubSearch(base, KEY, ["x", "tiktok"]);
  assert.equal(out.x.dataProvider, "tikhub");
  assert.equal(out.x.rateLimit().key, "tikhub:x");
  assert.equal(out.x.expandComments, base.x.expandComments, "comment expansion stays on API Direct");
  assert.equal(out.tiktok.streams![0]!.capabilities.sortNewest, false);
  assert.equal(out.reddit, base.reddit);
  assert.equal(withTikhubSearch(base, undefined, ["x"]), base, "no key: unchanged");
  assert.ok(new SourceError("auth", "x"));
});
