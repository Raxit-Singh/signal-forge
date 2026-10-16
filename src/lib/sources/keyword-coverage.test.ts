// Keyword coverage across every connector: no first-5 limit, OR consolidation,
// fair rotation with a 7-day guarantee, per-keyword effective intervals, and the
// development-only interval entitlement. Pure; no database, no network.
import { test } from "node:test";
import assert from "node:assert/strict";

import { devMonitoringFloor } from "../domain/dev-entitlement.ts";
import {
  KEYWORD_COVERAGE_GUARANTEE_MINUTES, keywordIntervalMinutes, planPlatformKeywords, rotationNextRun, rotationTurns, searchBudget,
  STACKEXCHANGE_ANON_BUDGET, type Rotation,
} from "./keyword-plan.ts";
import { buildQueryGroups, resolveEnablement } from "./query-groups.ts";
import type { OptimizerKeyword } from "./query-optimizer.ts";
import { createAdapters, PUBLIC_SOURCES } from "./registry.ts";

const kw = (term: string, kind: OptimizerKeyword["kind"] = "exact_name", extra: Partial<OptimizerKeyword> = {}): OptimizerKeyword =>
  ({ term, kind, isAmbiguous: false, contextTerms: [], ...extra });

// Ten keywords: brand, domain, handle, two spellings (one a case duplicate), two brand phrases,
// two category phrases and a competitor.
const TEN: OptimizerKeyword[] = [
  kw("Octolens"), kw("octolens.com", "domain"), kw("@octolens", "handle"), kw("Octo Lens", "misspelling"), kw("octolens", "misspelling"),
  kw("Octolens pricing", "custom"), kw("Octolens alternative", "custom"), kw("social listening", "custom"),
  kw("brand monitoring", "custom"), kw("Syften", "custom"),
];
const adapters = createAdapters({ apiDirectKey: "test", youtubeApiKey: "test" });
const budget = { planMaxSearches: 2, stackExchangeKey: false };

test("every keyword is monitored on every platform that can search it — none dropped by search limits", () => {
  for (const id of PUBLIC_SOURCES) {
    const p = planPlatformKeywords(id, adapters[id], TEN, budget);
    if (p.productOnly) {
      assert.ok(p.keywords.every((k) => k.status === "not_applicable"), id);
      continue;
    }
    assert.equal(p.keywords.length, TEN.length, `${id}: one coverage entry per keyword`);
    for (const k of p.keywords) {
      // DEV only has tag feeds: a domain or @handle can't be a tag. Everything else must be searchable.
      if (id === "dev" && /[.@]/.test(k.term)) {
        assert.equal(k.status, "unsupported", `${id}: ${k.term}`);
        continue;
      }
      assert.notEqual(k.status, "unsupported", `${id}: "${k.term}" should be searchable (${k.detail})`);
      if (k.status === "covered" || k.status === "duplicate") assert.ok(p.searched.includes(k.via!), `${id}: ${k.term} via ${k.via}`);
    }
    assert.equal(p.skipped.filter((s) => s.reason === "query_cap").length, 0, `${id}: nothing skipped for a search cap`);
  }
});

test("Milestone 2 sources search all keywords, not the first 5", () => {
  const hn = planPlatformKeywords("hackernews", adapters.hackernews, TEN, budget);
  // 10 keywords: 1 case duplicate + 2 brand phrases covered by "Octolens" → 7 searches, one per keyword.
  assert.equal(hn.searches, 7);
  assert.ok(["Syften", "brand monitoring", "@octolens", "social listening"].every((t) => hn.searched.includes(t)));
  const gh = planPlatformKeywords("github", adapters.github, TEN, budget);
  assert.equal(gh.booleanOr, "OR");
  assert.deepEqual(gh.streams[0]!.groups.map((g) => g.terms.length), [4, 3], "OR groups split at GitHub's 5-term limit (brand vs category)");
  const yt = planPlatformKeywords("youtube", adapters.youtube, TEN, budget);
  assert.equal(yt.searched.length, 7);
  assert.ok(yt.streams[0]!.groups.every((g) => g.terms.length <= 5 && g.rotation === null));
});

test("OR platforms consolidate; Reddit plans posts and comments separately", () => {
  const reddit = planPlatformKeywords("reddit", adapters.reddit, TEN, budget);
  assert.deepEqual(reddit.streams.map((s) => [s.stream, s.groups.length]), [["posts", 2], ["comments", 2]]);
  assert.equal(reddit.searched.length, 7);
  assert.ok(reddit.keywords.every((k) => k.status !== "rotating"), "no rotation where OR fits everything");
});

test("platforms without OR and a search budget rotate fairly; the product name keeps every check", () => {
  assert.equal(searchBudget("tiktok", adapters.tiktok, budget), 2);
  assert.equal(searchBudget("bluesky", adapters.bluesky, budget), null, "free platforms: no budget");
  assert.equal(searchBudget("stackexchange", adapters.stackexchange, budget), STACKEXCHANGE_ANON_BUDGET);
  assert.equal(searchBudget("stackexchange", adapters.stackexchange, { ...budget, stackExchangeKey: true }), null);

  const tiktok = planPlatformKeywords("tiktok", adapters.tiktok, TEN, budget);
  const groups = tiktok.streams[0]!.groups;
  assert.equal(groups[0]!.terms[0], "Octolens");
  assert.equal(groups[0]!.rotation, null, "highest-priority search every check");
  assert.ok(groups.slice(1).every((g) => g.rotation && g.rotation.slots === 1 && g.rotation.rotating === groups.length - 1));
  assert.equal(tiktok.keywords.find((k) => k.term === "Syften")!.status, "rotating");
  assert.equal(tiktok.searchesPerCheck, 2, "budget respected on average");
  // Budget 1: everything rotates.
  const one = planPlatformKeywords("tiktok", adapters.tiktok, TEN, { ...budget, planMaxSearches: 1 });
  assert.ok(one.streams[0]!.groups.every((g) => g.rotation));
});

test("rotation slots: each search gets the same share, no slot exceeds the budget, all keywords within the period", () => {
  const rotating = 6;
  const slots = 1;
  const intervalMin = 360;
  const turns = rotationTurns({ position: 0, rotating, slots }, intervalMin);
  assert.equal(turns, 6);
  const runs = new Map<number, number[]>();
  for (let position = 0; position < rotating; position++) {
    const r: Rotation = { position, rotating, slots };
    let t = new Date("2026-10-16T00:00:00Z");
    for (let i = 0; i < 5; i++) {
      t = rotationNextRun(t, intervalMin, r);
      const slot = t.getTime() / (intervalMin * 60_000);
      runs.set(slot, [...(runs.get(slot) ?? []), position]);
    }
  }
  for (const [, who] of runs) assert.ok(who.length <= slots, `at most ${slots} rotating search per slot: ${who}`);
  // Over 6 consecutive slots every position runs exactly once.
  const first = Math.min(...runs.keys());
  const window = [...Array(turns).keys()].flatMap((i) => runs.get(first + i) ?? []);
  assert.deepEqual(window.sort(), [0, 1, 2, 3, 4, 5]);
  assert.equal(keywordIntervalMinutes(intervalMin, { position: 3, rotating, slots }), 36 * 60);
  assert.equal(keywordIntervalMinutes(intervalMin, null), intervalMin);
});

test("7-day minimum coverage guarantee overrides the budget when rotation would take longer", () => {
  const r: Rotation = { position: 0, rotating: 9, slots: 1 };
  assert.equal(keywordIntervalMinutes(1440, r), KEYWORD_COVERAGE_GUARANTEE_MINUTES, "daily plan: 9 turns → capped at 7 days");
  assert.equal(rotationTurns(r, 1440), 7);
  assert.equal(keywordIntervalMinutes(180, r), 27 * 60, "3 h plan: 9 turns → 27 h, within the guarantee");
  for (const interval of [60, 120, 180, 240, 360, 720, 1440]) {
    for (let rot = 2; rot <= 10; rot++) {
      assert.ok(keywordIntervalMinutes(interval, { position: 0, rotating: rot, slots: 1 }) <= KEYWORD_COVERAGE_GUARANTEE_MINUTES);
    }
  }
});

test("ambiguous keywords are searched with context where possible, not dropped", () => {
  const flow = kw("Flow", "abbreviation", { isAmbiguous: true, contextTerms: ["pomodoro", "focus timer"] });
  const tiktok = planPlatformKeywords("tiktok", adapters.tiktok, [kw("FocusFlow"), flow], budget);
  assert.equal(tiktok.streams[0]!.groups.find((g) => g.role === "ambiguous")?.expression, "Flow pomodoro");
  const reddit = planPlatformKeywords("reddit", adapters.reddit, [kw("FocusFlow"), flow], budget);
  assert.equal(reddit.streams[0]!.groups.find((g) => g.role === "ambiguous")?.expression, 'Flow (pomodoro OR "focus timer")');
  const dev = planPlatformKeywords("dev", adapters.dev, [kw("FocusFlow"), flow], budget);
  assert.equal(dev.keywords.find((k) => k.term === "Flow")!.status, "unsupported", "tag feeds can't require context");
  const noContext = planPlatformKeywords("reddit", adapters.reddit, [kw("FocusFlow"), kw("FF", "abbreviation", { isAmbiguous: true })], budget);
  assert.match(noContext.keywords.find((k) => k.term === "FF")!.detail, /add context words/);
});

test("query groups for a product: all four Milestone 2 sources from the planner, rotation stored with the group", () => {
  const product = { id: "11111111-1111-1111-1111-111111111111", workspace_id: "w", website_url: "https://octolens.com", app_store_url: null, archived_at: null };
  const settings = new Map([["tiktok", true]]);
  const enablement = resolveEnablement(adapters, product, settings, 5, true);
  assert.ok(["hackernews", "github", "stackexchange", "youtube"].every((id) => enablement.find((e) => e.id === id)?.enabled));
  const groups = buildQueryGroups(product, TEN, enablement, adapters, budget);
  assert.equal(groups.filter((g) => g.provider === "hackernews").length, 7);
  const rotatingTikTok = groups.filter((g) => g.provider === "tiktok" && g.params.rotation);
  assert.equal(rotatingTikTok.length, groups.filter((g) => g.provider === "tiktok").length - 1);
  assert.ok(groups.every((g) => /^[0-9a-f]{64}$/.test(g.fingerprint)));
  // Unconfigured sources produce no groups.
  const noYoutube = resolveEnablement(createAdapters({}), product, settings, 0, false);
  assert.equal(noYoutube.find((e) => e.id === "youtube")?.enabled, false);
});

test("development-only interval entitlement is inert unless every condition holds", () => {
  const ws = "6a35881d-3e39-428a-96c3-b2c2f545a1e9";
  const ok = { NODE_ENV: "development", DEV_MONITORING_MIN_INTERVAL_MINUTES: "60", DEV_MONITORING_WORKSPACES: `x, ${ws}` };
  assert.equal(devMonitoringFloor(ok, ws), 60);
  assert.equal(devMonitoringFloor({ ...ok, NODE_ENV: "production" }, ws), null, "never in production builds");
  assert.equal(devMonitoringFloor({ ...ok, NODE_ENV: "test" }, ws), null);
  assert.equal(devMonitoringFloor({ ...ok, VERCEL_ENV: "preview" }, ws), null, "never on Vercel deployments");
  assert.equal(devMonitoringFloor({ ...ok, DEV_MONITORING_WORKSPACES: "*" }, ws), null, "no wildcard");
  assert.equal(devMonitoringFloor(ok, "00000000-0000-0000-0000-000000000000"), null, "only listed workspaces");
  assert.equal(devMonitoringFloor({ ...ok, DEV_MONITORING_MIN_INTERVAL_MINUTES: "15" }, ws), null, "1 h is the shortest interval");
  assert.equal(devMonitoringFloor({ ...ok, DEV_MONITORING_MIN_INTERVAL_MINUTES: "abc" }, ws), null);
});
