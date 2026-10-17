import { test } from "node:test";
import assert from "node:assert/strict";

import { buildIssueBody, demandStrength, issueSearchQuery, MAX_BODY_FOR_URL, newIssueUrl, rankMatches, searchTerms } from "./insights.ts";

const observed = (o: Partial<Parameters<typeof demandStrength>[0]> = {}) => ({
  independent_reporters: 2, mentions: 2, platforms: ["reddit"], last_7_days: 1, previous_7_days: 1, trend: "steady" as const,
  weeks_active: 1, recurring: false, first_seen: "2026-10-01", last_seen: "2026-10-10", negative_share: 0, ...o,
});

test("demand strength comes from measured facts: people, platforms, recurrence, trend", () => {
  assert.equal(demandStrength(observed()).level, "early");
  assert.match(demandStrength(observed()).reasons[0]!, /Only 2 different people/);
  assert.equal(demandStrength(observed({ independent_reporters: 6, platforms: ["reddit", "github"] })).level, "moderate");
  const strong = demandStrength(observed({ independent_reporters: 12, platforms: ["reddit", "github", "hackernews"], recurring: true, weeks_active: 4, trend: "growing" }));
  assert.equal(strong.level, "strong");
  assert.ok(strong.reasons.includes("Requested in 4 different weeks"));
  // Many mentions from few people stay "early": volume alone isn't demand.
  assert.equal(demandStrength(observed({ mentions: 500, independent_reporters: 2 })).level, "early");
});

test("issue body: cited statements numbered in order, hypotheses separate, sources from stored data, no markup or pings from model text", () => {
  const body = buildIssueBody({
    title: "Login freezes",
    summary: "Users report the app freezes at login. @maintainer please look",
    details: [
      { statement: "The app freezes on the login screen <script>", mentionIds: ["m2", "m1"] },
      { statement: "Started after an update", tier: "hypothesis", mentionIds: ["m1"] },
      { statement: "Happens on **macOS**", tier: "reported", mentionIds: ["m3"] },
    ],
  }, [
    { mention_id: "m1", url: "https://reddit.com/r/x/1", source: "reddit", title: "Freeze (again)", published_at: "2026-10-02T00:00:00Z" },
    { mention_id: "m2", url: "https://news.ycombinator.com/item?id=2", source: "hackernews", title: "Login hang", published_at: "2026-10-01T00:00:00Z" },
    { mention_id: "m3", url: "https://github.com/a/b/issues/3", source: "github", title: null, published_at: "2026-10-03T00:00:00Z" },
  ], { reporters: 3, platforms: ["reddit", "hackernews"], firstSeen: "2026-10-01T00:00:00Z", lastSeen: "2026-10-03T00:00:00Z" }, (s) => s.toUpperCase());
  assert.match(body, /- The app freezes on the login screen script \[1\]\[2\]/);
  assert.match(body, /- Happens on macOS \[3\]/);
  assert.match(body, /### Possible explanations \(not confirmed\)\n- Started after an update \[2\]/);
  assert.match(body, /1\. \[Login hang\]\(https:\/\/news\.ycombinator\.com\/item\?id=2\) — HACKERNEWS, 2026-10-01/);
  assert.match(body, /2\. \[Freeze \(again\)\]\(https:\/\/reddit\.com\/r\/x\/1\)/);
  assert.match(body, /3 independent reporters on REDDIT, HACKERNEWS, 2026-10-01 to 2026-10-03/);
  assert.ok(!body.includes("@maintainer"), "no @mentions");
  assert.ok(!body.includes("<script>"));
});

test("new issue URL: prefilled for the user to submit; invalid repos rejected; long bodies shortened", () => {
  const u = new URL(newIssueUrl("acme/app", "Login freezes", "Body text"));
  assert.equal(u.origin + u.pathname, "https://github.com/acme/app/issues/new");
  assert.equal(u.searchParams.get("title"), "Login freezes");
  assert.equal(u.searchParams.get("body"), "Body text");
  assert.throws(() => newIssueUrl("acme/app/../../x", "t", "b"));
  assert.throws(() => newIssueUrl("https://evil.example", "t", "b"));
  const long = Array.from({ length: 400 }, (_, i) => `line ${i} ${"x".repeat(20)}`).join("\n");
  const body = new URL(newIssueUrl("acme/app", "t", long)).searchParams.get("body")!;
  assert.ok(body.length <= MAX_BODY_FOR_URL);
  assert.match(body, /Shortened/);
});

test("duplicate search: distinctive words without the product name; matches ranked, 'likely' only with real overlap", () => {
  const words = searchTerms({ title: "Bug reports: login freeze", area: "login", topTerms: ["freeze", "acme", "spinner"] }, "Acme");
  assert.deepEqual(words, ["login", "freeze", "spinner"]);
  assert.equal(issueSearchQuery("acme/app", words), "repo:acme/app is:issue login OR freeze OR spinner");
  // Words recurring across the issue's posts fill in when there are few stored terms; one-off words don't.
  assert.deepEqual(searchTerms({ title: "Bug reports: login", area: "login", topTerms: [] }, "Acme", [
    "Acme freezes when I login", "Login screen freezes forever", "Signing in is stuck", "Stuck on the spinner",
  ]), ["login", "freezes", "stuck"]);
  const ranked = rankMatches([
    { number: 1, title: "Dark mode request", url: "u1", state: "open", updatedAt: "2026-10-01", comments: 0 },
    { number: 2, title: "App freezes on login screen", url: "u2", state: "closed", updatedAt: "2026-09-01", comments: 3 },
    { number: 3, title: "Login page typo", url: "u3", state: "open", updatedAt: "2026-10-05", comments: 1 },
  ], words);
  assert.deepEqual(ranked.map((m) => m.number), [2, 3]);
  assert.equal(ranked[0]!.likely, true, "two of three words shared");
  assert.equal(ranked[1]!.likely, false, "one shared word is only 'possibly related'");
});
