// Serper web + news against mock responses in Serper's documented shape. No network.
import { test } from "node:test";
import assert from "node:assert/strict";

import type { BillingIntent, BillingOutcome, SourceContext, SourceRequest } from "../types.ts";
import { createSerperSearch, parseSerperDate, serperError, serperTimeFilter } from "./serper.ts";

const NOW = new Date("2026-10-22T12:00:00Z");
const WINDOW = { since: new Date("2026-10-21T00:00:00Z"), until: NOW };

function ctxWith(body: unknown, status = 200) {
  const calls: Array<{ req: SourceRequest & { billing: BillingIntent }; outcome?: BillingOutcome }> = [];
  const ctx: SourceContext = {
    async request() { throw new Error("paid only"); },
    async paidRequest(req) {
      const call: { req: typeof req; outcome?: BillingOutcome } = { req };
      calls.push(call);
      return { response: new Response(JSON.stringify(body), { status }), ledgerId: "l1", settle: async (o) => { call.outcome = o; } };
    },
    async cooldown() {},
    now: () => NOW,
  };
  return { ctx, calls };
}

test("Serper dates and time filters", () => {
  assert.equal(parseSerperDate("3 hours ago", NOW)!.toISOString(), "2026-10-22T09:00:00.000Z");
  assert.equal(parseSerperDate("2 days ago", NOW)!.toISOString(), "2026-10-20T12:00:00.000Z");
  assert.equal(parseSerperDate("Oct 21, 2026", NOW)!.toISOString().slice(0, 10), "2026-10-21");
  assert.equal(parseSerperDate("sometime", NOW), null);
  assert.equal(serperTimeFilter(36 * 3_600_000), "qdr:w");
  assert.equal(serperTimeFilter(20 * 3_600_000), "qdr:d");
  assert.equal(serperTimeFilter(800 * 86_400_000), undefined);
  assert.equal(serperError(401, "").kind, "auth");
  assert.equal(serperError(400, "Not enough credits").kind, "budget");
});

test("News: POST with the key in a header, 100 articles for one billed query, window enforced, own site dropped", async () => {
  const { ctx, calls } = ctxWith({ news: [
    { title: "Toing launches in Pune with ₹99 meals for students", link: "https://news.example/toing-pune", snippet: "Swiggy's toing…", date: "5 hours ago", source: "Example News" },
    { title: "An older story about toing expanding to Mumbai", link: "https://news.example/old", snippet: "", date: "Oct 1, 2026", source: "Example" },
    { title: "Toing official blog post", link: "https://toingit.com/blog", date: "1 hour ago" },
  ] });
  const r = await createSerperSearch("sk_test").news({ terms: ["toing"], window: WINDOW, maxPages: 1, target: { websiteDomain: "toingit.com" } }, ctx);
  const req = calls[0]!.req;
  assert.equal(req.method, "POST");
  assert.equal(req.headers!["X-API-KEY"], "sk_test");
  assert.ok(!req.url.includes("sk_test"));
  assert.deepEqual(JSON.parse(req.body!), { q: "toing", num: 100, tbs: "qdr:w" });
  assert.equal(req.billing.pricingKey, "serper_news.search");
  assert.equal(calls[0]!.outcome?.billedUnits, 1);
  assert.deepEqual(r.items.map((i) => i.sourceUrl), ["https://news.example/toing-pune"]);
  assert.equal(r.items[0]!.dataProvider, "serper");
  assert.equal(r.items[0]!.community, "Example News");
});

test("Web: 10 results, estimated dates like API Direct, failed queries settle at zero", async () => {
  const { ctx } = ctxWith({ organic: [{ title: "Toing review", link: "https://blog.example/toing-review", snippet: "I tried toing" }] });
  const r = await createSerperSearch("sk_test").web({ terms: ["toing app"], window: WINDOW, maxPages: 1 }, ctx);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0]!.publishedAtEstimated, true);
  const bad = ctxWith({ message: "Unauthorized" }, 401);
  await assert.rejects(createSerperSearch("x").web({ terms: ["toing"], window: WINDOW, maxPages: 1 }, bad.ctx), (e: Error & { kind?: string }) => e.kind === "auth");
  assert.equal(bad.calls[0]!.outcome?.billedUnits, 0);
});
