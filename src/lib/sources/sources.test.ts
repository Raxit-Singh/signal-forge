import { test } from "node:test";
import assert from "node:assert/strict";

import { SourceError, retryAfterSeconds, secondsUntilPacificMidnight, secondsUntilUtcMidnight } from "./errors.ts";
import { canonicalLink, contentHash, excerpt, htmlToText, markdownToText } from "./text.ts";
import { evaluateRelevance, type AliasRule } from "./relevance.ts";
import { hackerNews, hnQuery, normalizeHnHit, type HnHit } from "./hackernews.ts";
import { createGithubAdapter, githubQuery, normalizeGithubIssue, type GithubIssue } from "./github.ts";
import { createStackExchangeAdapter, normalizeSeItem } from "./stackexchange.ts";
import { createYoutubeAdapter, youtubeQuery } from "./youtube.ts";
import { prepareIngest } from "./pipeline.ts";
import type { SourceContext, SourceRequest } from "./types.ts";

// ---------------------------------------------------------------- helpers

const NOW = new Date("2026-10-14T12:00:00Z");
const WINDOW = { since: new Date("2026-10-01T00:00:00Z"), until: NOW };

function rule(term: string, extra: Partial<AliasRule> = {}): AliasRule {
  return { term, kind: "exact_name", isAmbiguous: false, contextTerms: [], negativeTerms: [], enabled: true, ...extra };
}

type Route = (url: URL, req: SourceRequest) => Response | undefined;

function fakeCtx(routes: Route[]) {
  const calls: SourceRequest[] = [];
  const cooldowns: number[] = [];
  const ctx: SourceContext = {
    async request(req) {
      calls.push(req);
      const u = new URL(req.url);
      for (const r of routes) {
        const res = r(u, req);
        if (res) return res;
      }
      throw new Error(`unexpected request ${req.url}`);
    },
    async cooldown(s) {
      cooldowns.push(s);
    },
    now: () => NOW,
  };
  return { ctx, calls, cooldowns };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

// ---------------------------------------------------------------- text

test("htmlToText strips tags, keeps paragraphs, decodes entities", () => {
  assert.equal(htmlToText("I&#x27;m <i>happy</i><p>New &amp; improved &lt;3"), "I'm happy\nNew & improved <3");
  assert.equal(htmlToText('<a href="x">link</a> &quot;q&quot; &#128512;'), 'link "q" 😀');
  assert.equal(htmlToText(null), "");
});

test("markdownToText turns issue bodies into readable text", () => {
  const md = "Type: <b>Bug</b>\n\n### Description\n<!-- template hint -->\nThe **export** drops `arrows`. See [docs](https://x.y).\n\n```js\nconsole.log(1)\n```\n- [x] checked\n<details><summary>Env</summary>dump</details>\n![img](https://i.png)";
  const text = markdownToText(md);
  assert.equal(text.split("\n")[0], "Type: Bug");
  assert.match(text, /^Description$/m);
  assert.match(text, /^The export drops arrows\. See docs\.$/m);
  assert.match(text, /^\[code\]$/m);
  assert.match(text, /^• checked$/m);
  assert.doesNotMatch(text, /[<>#*`]|template hint|dump|console|https?:/);
  assert.equal(markdownToText(null), "");
});

test("excerpt trims on a word boundary", () => {
  const long = "word ".repeat(1000);
  const e = excerpt(long, 100)!;
  assert.ok(e.length <= 100 && e.endsWith("…"));
  assert.equal(excerpt("  short  "), "short");
  assert.equal(excerpt(""), null);
});

test("contentHash ignores case/punctuation and refuses short texts", () => {
  const a = "FocusFlow crashes every time I start a pomodoro session on macOS Sonoma!!";
  const b = "focusflow crashes every time i start a pomodoro session on macos sonoma";
  assert.equal(contentHash(a), contentHash(b));
  assert.notEqual(contentHash(a), contentHash(`${b} too`));
  assert.equal(contentHash("+1 same here"), null);
});

test("canonicalLink normalizes for repost detection", () => {
  assert.equal(canonicalLink("https://www.Example.com/post/?utm_source=hn&b=2&a=1#top"), "example.com/post?a=1&b=2");
  assert.equal(canonicalLink("http://example.com/post"), canonicalLink("https://example.com/post/"));
  assert.equal(canonicalLink("javascript:alert(1)"), null);
  assert.equal(canonicalLink("not a url"), null);
});

// ---------------------------------------------------------------- relevance

test("relevance: distinctive name matches as a whole word only", () => {
  const rules = [rule("FocusFlow")];
  assert.equal(evaluateRelevance(rules, "Trying FocusFlow today")?.status, "relevant");
  assert.equal(evaluateRelevance(rules, "focusflow's timer is great")?.status, "relevant");
  assert.equal(evaluateRelevance(rules, "MyFocusFlowClone is different"), null);
});

test("relevance: product sentiment example from the spec still matches the product", () => {
  const m = evaluateRelevance([rule("FocusFlow")], "I hate that my previous app crashed, but FocusFlow is excellent.");
  assert.deepEqual(m?.matchedTerms, ["FocusFlow"]);
});

test("relevance: ambiguous terms need a context term and are left for review", () => {
  const rules = [rule("Linear", { isAmbiguous: true, contextTerms: ["issue tracker", "linear.app"] })];
  assert.equal(evaluateRelevance(rules, "Linear regression in numpy"), null);
  const m = evaluateRelevance(rules, "Moved our issue tracker to Linear last week");
  assert.equal(m?.status, "pending");
  assert.equal(m?.score, 0.6);
  assert.equal(evaluateRelevance([rule("Linear", { isAmbiguous: true })], "Linear issue tracker"), null, "ambiguous without context never matches");
});

test("relevance: exclusion terms veto a keyword", () => {
  const rules = [rule("Flow", { kind: "custom", negativeTerms: ["tensorflow", "airflow"] })];
  assert.equal(evaluateRelevance(rules, "Flow and Airflow compared"), null);
  assert.ok(evaluateRelevance(rules, "Flow is my favourite timer"));
});

test("relevance: domains and repo slugs are strong; multiple keywords add confidence", () => {
  const rules = [rule("focusflow.app", { kind: "domain" }), rule("FocusFlow"), rule("acme/focusflow", { kind: "custom" })];
  assert.equal(evaluateRelevance([rules[0]!], "see https://www.focusflow.app/pricing")?.score, 0.95);
  assert.equal(evaluateRelevance([rules[2]!], "bug in acme/focusflow#12")?.score, 0.95);
  const both = evaluateRelevance(rules, "FocusFlow (focusflow.app) launched")!;
  assert.equal(both.score, 0.99, "0.95 + 0.05 for a second keyword, capped below 1");
  assert.deepEqual(both.matchedTerms.sort(), ["FocusFlow", "focusflow.app"]);
});

test("relevance: thread context alone gives a low-confidence pending match", () => {
  const rules = [rule("FocusFlow"), rule("Flow", { isAmbiguous: true, contextTerms: ["pomodoro"] })];
  const m = evaluateRelevance(rules, "It crashes on my mac", "Show HN: FocusFlow");
  assert.equal(m?.basis, "thread");
  assert.equal(m?.status, "pending");
  assert.equal(m?.score, 0.5);
  // Ambiguous keywords never qualify by thread alone.
  assert.equal(evaluateRelevance([rules[1]!], "it crashes", "Flow pomodoro"), null);
  // Context terms may come from the thread.
  assert.equal(evaluateRelevance([rules[1]!], "Flow keeps crashing", "pomodoro apps thread")?.status, "pending");
});

test("relevance: disabled keywords never match", () => {
  assert.equal(evaluateRelevance([rule("FocusFlow", { enabled: false })], "FocusFlow"), null);
});

// ---------------------------------------------------------------- errors

test("retry-after parsing and quota reset times", () => {
  assert.equal(retryAfterSeconds("120"), 120);
  assert.equal(retryAfterSeconds(new Date(Date.now() + 30_000).toUTCString()) !== undefined, true);
  assert.equal(retryAfterSeconds(null), undefined);
  assert.equal(secondsUntilUtcMidnight(new Date("2026-10-14T23:59:00Z")), 60);
  const pt = secondsUntilPacificMidnight(new Date("2026-10-14T06:30:00Z")); // 23:30 PDT
  assert.equal(pt, 1800);
});

// ---------------------------------------------------------------- Hacker News

const hnStory: HnHit = {
  objectID: "50074864", _tags: ["story", "show_hn"], author: "alice", created_at_i: 1791910521,
  title: "Show HN: FocusFlow – a pomodoro timer", url: "https://www.focusflow.app/?utm_source=hn",
  story_text: null, points: 42, num_comments: 7,
};
const hnComment: HnHit = {
  objectID: "50016292", _tags: ["comment"], author: "bob", created_at_i: 1791523248,
  comment_text: "I&#x27;ve used <i>FocusFlow</i> for a month.<p>Love it.", story_id: 50015848,
  story_title: "Ask HN: Favourite timers?", parent_id: 50015848,
};

test("HN: normalizes stories and comments", () => {
  const s = normalizeHnHit(hnStory)!;
  assert.equal(s.sourceUrl, "https://news.ycombinator.com/item?id=50074864");
  assert.equal(s.linkedUrl, "focusflow.app");
  assert.deepEqual(s.engagement, { points: 42, comments: 7 });
  assert.equal(s.engagementScore, 49);
  const c = normalizeHnHit(hnComment)!;
  assert.equal(c.title, "Re: Ask HN: Favourite timers?");
  assert.equal(c.content, "I've used FocusFlow for a month.\nLove it.");
  assert.equal(c.parentExternalId, "50015848");
  assert.equal(c.linkedUrl, null);
  assert.deepEqual(c.engagement, {});
});

test("HN: quotes phrases, filters by window, pages until done", async () => {
  assert.equal(hnQuery("FocusFlow"), "FocusFlow");
  assert.equal(hnQuery("focusflow.app"), '"focusflow.app"');
  const { ctx, calls } = fakeCtx([
    (u) => (u.pathname.endsWith("/search_by_date") && u.searchParams.get("page") === "0"
      ? json({ hits: [hnStory], nbHits: 2, nbPages: 2, page: 0 }) : undefined),
    (u) => (u.pathname.endsWith("/search_by_date") && u.searchParams.get("page") === "1"
      ? json({ hits: [hnComment], nbHits: 2, nbPages: 2, page: 1 }) : undefined),
  ]);
  const r = await hackerNews.searchMentions({ terms: ["FocusFlow"], window: WINDOW, maxPages: 3 }, ctx);
  assert.equal(r.items.length, 2);
  assert.equal(r.complete, true);
  assert.equal(calls.length, 2);
  const nf = new URL(calls[0]!.url).searchParams.get("numericFilters")!;
  assert.equal(nf, `created_at_i>=${WINDOW.since.getTime() / 1000},created_at_i<${NOW.getTime() / 1000}`);
});

test("HN: page cap marks coverage partial", async () => {
  const { ctx } = fakeCtx([() => json({ hits: [hnStory], nbHits: 900, nbPages: 9, page: 0 })]);
  const r = await hackerNews.searchMentions({ terms: ["FocusFlow"], window: WINDOW, maxPages: 1 }, ctx);
  assert.equal(r.complete, false);
  assert.match(r.incompleteReason!, /only the newest/);
});

test("HN: 429 becomes a retryable rate-limit error", async () => {
  const { ctx } = fakeCtx([() => new Response("slow down", { status: 429, headers: { "retry-after": "30" } })]);
  await assert.rejects(
    hackerNews.searchMentions({ terms: ["x"], window: WINDOW, maxPages: 1 }, ctx),
    (e: unknown) => e instanceof SourceError && e.kind === "rate_limited" && e.retryAfterSeconds === 30 && e.retryable,
  );
});

// ---------------------------------------------------------------- GitHub

const ghIssue: GithubIssue = {
  id: 5848806187, html_url: "https://github.com/acme/focusflow/issues/12", title: "FocusFlow crashes on start",
  body: "Steps: open FocusFlow…", created_at: "2026-10-10T13:35:51Z", comments: 3,
  repository_url: "https://api.github.com/repos/acme/focusflow", user: { login: "dev1", id: 77, type: "User" },
  reactions: { total_count: 5 },
};

test("GitHub: query combines terms with OR and an exact window", () => {
  const q = githubQuery(["FocusFlow", "focusflow.app", "a", "b", "c", "d"], WINDOW.since, NOW);
  assert.equal(q, '"FocusFlow" OR "focusflow.app" OR "a" OR "b" OR "c" in:title,body is:issue created:2026-10-01T00:00:00Z..2026-10-14T11:59:59Z');
});

test("GitHub: normalizes issues and skips bots and pull requests", () => {
  const m = normalizeGithubIssue(ghIssue)!;
  assert.equal(m.parentExternalId, "acme/focusflow");
  assert.equal(m.authorExternalId, "77");
  assert.deepEqual(m.engagement, { comments: 3, reactions: 5 });
  assert.equal(normalizeGithubIssue({ ...ghIssue, user: { login: "renovate[bot]", type: "Bot" } }), null);
  assert.equal(normalizeGithubIssue({ ...ghIssue, pull_request: {} }), null);
});

test("GitHub: products named only in template dumps don't match; code blocks are weak evidence", () => {
  const rules = [rule("Excalidraw")];
  const dump = normalizeGithubIssue({ ...ghIssue, title: "Markdown preview is blank",
    body: "Preview broke.\n<!-- fill this in -->\n<details><summary>Extensions</summary>\nExcalidraw|pomdtr.excalidraw-editor|3.9.3\n</details>" })!;
  assert.equal(evaluateRelevance(rules, dump.matchText, dump.contextText), null);
  const code = normalizeGithubIssue({ ...ghIssue, title: "Canvas is blank on load",
    body: "Happens on Safari.\n```js\nimport { Excalidraw } from '@excalidraw/excalidraw'\n```" })!;
  const m = evaluateRelevance(rules, code.matchText, code.contextText);
  assert.equal(m?.status, "pending");
  const prose = normalizeGithubIssue({ ...ghIssue, title: "Export bug", body: "Excalidraw export drops arrows" })!;
  assert.equal(evaluateRelevance(rules, prose.matchText, prose.contextText)?.status, "relevant");
});

test("GitHub: exhausted rate limit is retryable after the reset", async () => {
  const reset = Math.floor(Date.now() / 1000) + 40;
  const { ctx } = fakeCtx([() => json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) })]);
  await assert.rejects(
    createGithubAdapter().searchMentions({ terms: ["x"], window: WINDOW, maxPages: 1 }, ctx),
    (e: unknown) => e instanceof SourceError && e.kind === "rate_limited" && (e.retryAfterSeconds ?? 0) >= 39,
  );
});

test("GitHub: token is sent, rate snapshot reported, 1000-result cap flagged", async () => {
  const { ctx, calls } = fakeCtx([() => json(
    { total_count: 5000, incomplete_results: false, items: Array.from({ length: 100 }, (_, i) => ({ ...ghIssue, id: i + 1 })) },
    200, { "x-ratelimit-remaining": "29", "x-ratelimit-limit": "30", "x-ratelimit-reset": "1791987110" })]);
  const r = await createGithubAdapter("tok").searchMentions({ terms: ["FocusFlow"], window: WINDOW, maxPages: 2 }, ctx);
  assert.equal(calls[0]!.headers!.Authorization, "Bearer tok");
  assert.equal(r.items.length, 100);
  assert.equal(r.complete, false);
  assert.equal(r.rateLimit?.remaining, 29);
  assert.equal(createGithubAdapter("tok").rateLimit().key, "github:search:token");
  assert.equal(createGithubAdapter().rateLimit().key, "github:search:anon");
});

// ---------------------------------------------------------------- Stack Exchange

test("Stack Exchange: questions vs answers get stable ids and links", () => {
  const q = normalizeSeItem({ item_type: "question", question_id: 79800225, title: "How to use FocusFlow&#39;s API?", body: "Body", creation_date: 1761502331, score: 3, answer_count: 1 })!;
  assert.equal(q.externalId, "stackoverflow:q:79800225");
  assert.equal(q.sourceUrl, "https://stackoverflow.com/q/79800225");
  assert.equal(q.title, "How to use FocusFlow's API?");
  const a = normalizeSeItem({ item_type: "answer", question_id: 79800225, answer_id: 79800230, title: "How to use FocusFlow&#39;s API?", body: "Use it like so", creation_date: 1761502723, score: -2 })!;
  assert.equal(a.externalId, "stackoverflow:a:79800230");
  assert.equal(a.sourceUrl, "https://stackoverflow.com/a/79800230");
  assert.equal(a.engagementScore, 0, "negative scores don't count as engagement");
  assert.equal(a.contextText, "How to use FocusFlow's API?");
});

test("Stack Exchange: backoff is honoured and quota errors wait for the reset", async () => {
  const ok = fakeCtx([() => json({ items: [], has_more: false, quota_remaining: 250, quota_max: 300, backoff: 10 })]);
  const r = await createStackExchangeAdapter().searchMentions({ terms: ["x"], window: WINDOW, maxPages: 1 }, ok.ctx);
  assert.deepEqual(ok.cooldowns, [10]);
  assert.equal(r.rateLimit?.remaining, 250);

  const throttled = fakeCtx([() => json({ error_id: 502, error_name: "throttle_violation", error_message: "too many requests from this IP, more requests available in 3600 seconds" }, 400)]);
  await assert.rejects(
    createStackExchangeAdapter().searchMentions({ terms: ["x"], window: WINDOW, maxPages: 1 }, throttled.ctx),
    (e: unknown) => e instanceof SourceError && e.kind === "rate_limited" && e.retryAfterSeconds === 3600,
  );
  assert.deepEqual(throttled.cooldowns, [3600]);
});

test("Stack Exchange: key is passed when configured", async () => {
  const { ctx, calls } = fakeCtx([() => json({ items: [], has_more: false })]);
  await createStackExchangeAdapter("k123").searchMentions({ terms: ["x"], window: WINDOW, maxPages: 1 }, ctx);
  assert.equal(new URL(calls[0]!.url).searchParams.get("key"), "k123");
});

// ---------------------------------------------------------------- YouTube

test("YouTube: needs a server key; query uses | for OR", () => {
  assert.equal(createYoutubeAdapter().configured().ok, false);
  assert.equal(createYoutubeAdapter("k").configured().ok, true);
  assert.equal(youtubeQuery(["FocusFlow", "focus flow"]), 'FocusFlow|"focus flow"');
});

test("YouTube: one search, one stats call, comments on discussed videos; costs recorded", async () => {
  const { ctx, calls } = fakeCtx([
    (u) => (u.pathname.endsWith("/search") ? json({ items: [{ id: { videoId: "v1" } }, { id: { videoId: "v2" } }] }) : undefined),
    (u) => (u.pathname.endsWith("/videos") ? json({ items: [
      { id: "v1", snippet: { publishedAt: "2026-10-05T00:00:00Z", channelId: "c1", channelTitle: "Chan", title: "FocusFlow review", description: "Long review" }, statistics: { viewCount: "1000", likeCount: "50", commentCount: "2" } },
      { id: "v2", snippet: { publishedAt: "2026-10-06T00:00:00Z", title: "Other", description: "" }, statistics: { viewCount: "5", likeCount: "0", commentCount: "0" } },
    ] }) : undefined),
    (u) => (u.pathname.endsWith("/commentThreads") ? json({ items: [
      { id: "t1", snippet: { videoId: "v1", totalReplyCount: 1, topLevelComment: { snippet: { textOriginal: "It crashes for me", authorDisplayName: "@u", authorChannelId: { value: "uc1" }, likeCount: 3, publishedAt: "2026-10-07T00:00:00Z" } } } },
      { id: "t0", snippet: { videoId: "v1", topLevelComment: { snippet: { textOriginal: "old", publishedAt: "2026-09-01T00:00:00Z" } } } },
    ] }) : undefined),
  ]);
  const r = await createYoutubeAdapter("k").searchMentions({ terms: ["FocusFlow"], window: WINDOW, maxPages: 1 }, ctx);
  assert.deepEqual(calls.map((c) => [c.endpoint, c.cost]), [["search", 1], ["videos", 1], ["commentThreads", 1]]);
  const yt = createYoutubeAdapter("k");
  assert.equal(yt.rateLimit("search").key, "youtube:search", "search.list has its own daily bucket");
  assert.equal(yt.rateLimit("videos").key, "youtube:units");
  assert.deepEqual(r.items.map((i) => i.externalId), ["video:v1", "video:v2", "comment:t1"], "comments older than the window are skipped");
  const comment = r.items[2]!;
  assert.equal(comment.sourceUrl, "https://www.youtube.com/watch?v=v1&lc=t1");
  assert.equal(comment.contextText, "FocusFlow review");
  assert.equal(r.items[0]!.engagementScore, 52);
});

test("YouTube: quota exhaustion cools down until the Pacific reset", async () => {
  const { ctx, cooldowns } = fakeCtx([() => json({ error: { code: 403, errors: [{ reason: "quotaExceeded" }] } }, 403)]);
  await assert.rejects(
    createYoutubeAdapter("k").searchMentions({ terms: ["x"], window: WINDOW, maxPages: 1 }, ctx),
    (e: unknown) => e instanceof SourceError && e.kind === "quota" && e.retryable,
  );
  assert.equal(cooldowns.length, 1);
});

test("YouTube: rejected key is a non-retryable auth error", async () => {
  const { ctx } = fakeCtx([() => json({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", errors: [{ reason: "badRequest" }] } }, 400)]);
  await assert.rejects(
    createYoutubeAdapter("bad").searchMentions({ terms: ["x"], window: WINDOW, maxPages: 1 }, ctx),
    (e: unknown) => e instanceof SourceError && e.kind === "auth" && !e.retryable,
  );
});

// ---------------------------------------------------------------- pipeline

test("pipeline: filters by relevance, hashes content, applies retention, clamps future dates", () => {
  const story = normalizeHnHit(hnStory)!;
  const comment = normalizeHnHit({ ...hnComment, comment_text: "unrelated chatter about timers" })!;
  const future = { ...normalizeHnHit({ ...hnStory, objectID: "9" })!, publishedAt: new Date(NOW.getTime() + 3_600_000) };
  const badUrl = { ...story, externalId: "10", sourceUrl: "http://insecure.example" };
  const r = prepareIngest([story, comment, future, badUrl], [rule("FocusFlow")], { now: NOW, retentionDays: 30 });
  assert.equal(r.fetched, 4);
  assert.equal(r.filtered, 1);
  assert.equal(r.invalid, 1);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0]!.relevance_status, "relevant");
  assert.equal(r.items[0]!.retain_until, "2026-11-13T12:00:00.000Z");
  assert.equal(r.items[1]!.published_at, NOW.toISOString());
  assert.equal(r.items[0]!.content_hash, null, "stories without text have no hash");
});
