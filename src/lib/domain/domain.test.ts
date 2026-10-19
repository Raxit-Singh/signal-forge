import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeWebsiteUrl, parseGithubRepo, parseAppStoreUrl, parsePlayStoreUrl, safeRedirectPath,
} from "./urls.ts";
import { suggestAliases, isAmbiguousTerm, isAmbiguousCustomTerm, splitWords, contextKeywords, ensureBrandTerm, retargetBrandAliases } from "./aliases.ts";
import { checkKeywordLimit, checkProductLimit, effectivePlanId, formatPrice, mentionUsageLevel, planFromRow, planLimitMessage, usageFromRpc } from "./plans.ts";
import { fitSuggestionsToAllowance } from "./keyword-allowance.ts";
import { checkKeyShape, keyHint } from "./ai-providers.ts";
import { INTEGRATIONS } from "./integrations.ts";
import { PUBLIC_SOURCES } from "../sources/registry.ts";

test("normalizeWebsiteUrl adds https and extracts domain", () => {
  const r = normalizeWebsiteUrl("www.FocusFlow.app/");
  assert.ok(r.ok);
  assert.equal(r.value.url, "https://www.focusflow.app");
  assert.equal(r.value.domain, "focusflow.app");
});

test("normalizeWebsiteUrl keeps path, drops fragment", () => {
  const r = normalizeWebsiteUrl("https://example.com/product#pricing");
  assert.ok(r.ok);
  assert.equal(r.value.url, "https://example.com/product");
});

test("normalizeWebsiteUrl rejects unsafe or private targets", () => {
  for (const bad of [
    "javascript:alert(1)", "ftp://example.com", "http://localhost:3000", "https://127.0.0.1",
    "https://10.0.0.5", "https://192.168.1.1", "https://user:pw@example.com", "https://intranet",
    "https://foo.internal", "http://[::1]/", "", "   ",
  ]) {
    assert.equal(normalizeWebsiteUrl(bad).ok, false, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test("parseGithubRepo accepts common forms", () => {
  for (const input of [
    "acme/focus-flow", "https://github.com/acme/focus-flow", "github.com/acme/focus-flow/",
    "https://github.com/acme/focus-flow.git", "git@github.com:acme/focus-flow.git",
  ]) {
    const r = parseGithubRepo(input);
    assert.ok(r.ok, input);
    assert.equal(r.value.fullName, "acme/focus-flow");
  }
});

test("parseGithubRepo rejects malformed input", () => {
  for (const bad of ["acme", "acme/repo/extra", "-acme/repo", "acme-/repo", "acme/..", "ac me/repo", "acme/re po"]) {
    assert.equal(parseGithubRepo(bad).ok, false, bad);
  }
});

test("parseAppStoreUrl extracts app id and strips tracking params", () => {
  const r = parseAppStoreUrl("https://apps.apple.com/us/app/focusflow/id1234567890?mt=8&uo=4");
  assert.ok(r.ok);
  assert.equal(r.value.appId, "1234567890");
  assert.equal(r.value.url, "https://apps.apple.com/us/app/focusflow/id1234567890");
  assert.equal(parseAppStoreUrl("https://apps.apple.com.evil.com/id1234567890").ok, false);
  assert.equal(parseAppStoreUrl("http://apps.apple.com/us/app/x/id1234567890").ok, false);
  // Pasted from the share sheet with the app's title after the link.
  const shared = parseAppStoreUrl("https://apps.apple.com/in/app/erly-wake-up-early/id6751428380 Erly: Wake Up Early");
  assert.ok(shared.ok);
  assert.equal(shared.value.appId, "6751428380");
  assert.equal(shared.value.url, "https://apps.apple.com/in/app/erly-wake-up-early/id6751428380");
  const bare = parseAppStoreUrl("apps.apple.com/us/app/focusflow/id1234567890");
  assert.ok(bare.ok && bare.value.appId === "1234567890");
  assert.equal(parseAppStoreUrl("Erly https://evil.com/id1234567890").ok, false);
});

test("parsePlayStoreUrl extracts package name", () => {
  const r = parsePlayStoreUrl("https://play.google.com/store/apps/details?id=com.acme.focusflow&hl=en");
  assert.ok(r.ok);
  assert.equal(r.value.packageName, "com.acme.focusflow");
  assert.equal(parsePlayStoreUrl("https://play.google.com/store/apps/details?id=nodots").ok, false);
  assert.equal(parsePlayStoreUrl("https://evil.com/?id=com.acme.app").ok, false);
  const shared = parsePlayStoreUrl("Erly: Wake Up Early https://play.google.com/store/apps/details?id=com.erly.app");
  assert.ok(shared.ok && shared.value.packageName === "com.erly.app");
});

test("safeRedirectPath blocks open redirects", () => {
  assert.equal(safeRedirectPath("/mentions?x=1"), "/mentions?x=1");
  assert.equal(safeRedirectPath("//evil.com"), "/overview");
  assert.equal(safeRedirectPath("https://evil.com"), "/overview");
  assert.equal(safeRedirectPath("/\\evil.com"), "/overview");
  assert.equal(safeRedirectPath(null), "/overview");
  assert.equal(safeRedirectPath("/ok\n"), "/overview");
});

test("splitWords handles CamelCase, acronyms and separators", () => {
  assert.deepEqual(splitWords("FocusFlow"), ["Focus", "Flow"]);
  assert.deepEqual(splitWords("APIGuard"), ["API", "Guard"]);
  assert.deepEqual(splitWords("signal_forge-app"), ["signal", "forge", "app"]);
});

test("ambiguity detection flags common and short names", () => {
  assert.equal(isAmbiguousTerm("Linear"), true);
  assert.equal(isAmbiguousTerm("Notion"), true);
  assert.equal(isAmbiguousTerm("Arc"), true);
  assert.equal(isAmbiguousTerm("Focus Flow"), true);
  assert.equal(isAmbiguousTerm("FocusFlow"), false);
  assert.equal(isAmbiguousTerm("SignalForge"), false);
  assert.equal(isAmbiguousTerm("focusflow.app"), false);
});

test("suggestAliases for a distinctive CamelCase name", () => {
  const s = suggestAliases({
    name: "FocusFlow",
    websiteDomain: "focusflow.app",
    githubRepo: "acme/focusflow",
    description: "Pomodoro timer for developers with focus analytics",
    handles: ["focusflowapp", "bad handle!"],
  });
  const byTerm = new Map(s.map((a) => [a.term, a]));
  assert.equal(byTerm.get("FocusFlow")?.kind, "exact_name");
  assert.equal(byTerm.get("FocusFlow")?.isAmbiguous, false);
  assert.equal(byTerm.get("focusflow.app")?.kind, "domain");
  assert.equal(byTerm.get("acme/focusflow")?.enabled, true);
  assert.equal(byTerm.get("@focusflowapp")?.kind, "handle");
  assert.ok(!s.some((a) => a.term.includes("bad")), "invalid handle dropped");
  // "Focus Flow" (spaced) is a plain phrase -> ambiguous, needs context
  assert.equal(byTerm.get("Focus Flow")?.isAmbiguous, true);
  assert.ok((byTerm.get("Focus Flow")?.contextTerms.length ?? 0) > 0);
  // initials are opt-in
  assert.equal(byTerm.get("FF")?.enabled, false);
  // no case-insensitive duplicates
  const lower = s.map((a) => a.term.toLowerCase());
  assert.equal(new Set(lower).size, lower.length);
});

test("ambiguous product name gets context terms, or is disabled without any", () => {
  const withCtx = suggestAliases({ name: "Linear", websiteDomain: "linear.app", description: "Issue tracking for software teams" });
  const name = withCtx.find((a) => a.kind === "exact_name");
  assert.equal(name?.isAmbiguous, true);
  assert.equal(name?.enabled, true);
  assert.ok(name?.contextTerms.includes("linear.app"));
  assert.ok(name?.contextTerms.includes("issue"));

  const noCtx = suggestAliases({ name: "Notion" });
  assert.equal(noCtx[0]?.enabled, false, "ambiguous with no context must not be enabled");
});

test("contextKeywords excludes stopwords and the name itself", () => {
  const kw = contextKeywords({ name: "FocusFlow", category: "Productivity", description: "The focus timer app for developers. Timer, timer!" });
  assert.equal(kw[0], "timer");
  assert.ok(!kw.includes("the"));
  assert.ok(!kw.includes("focus"));
});

test("plan helpers", () => {
  const plan = planFromRow({
    id: "free", name: "Free", description: null, price_cents_monthly: 0, currency: "usd",
    max_products: 1, max_competitors_per_product: 0, monthly_mention_limit: 500, history_days: 30,
    monitoring_interval_minutes: 1440, monthly_ai_token_budget: "0", monthly_investigations: 0,
    features: { weekly_reports: true, bogus: "yes" },
  });
  assert.equal(plan.features.weekly_reports, true);
  assert.equal(plan.features.bogus, false);
  assert.deepEqual(checkProductLimit(plan, 0), { allowed: true, remaining: 1 });
  const blocked = checkProductLimit(plan, 1);
  assert.equal(blocked.allowed, false);
  assert.equal(effectivePlanId({ plan_id: "pro", status: "canceled" }), "free");
  assert.equal(effectivePlanId({ plan_id: "pro", status: "past_due" }), "pro");
  assert.equal(effectivePlanId(null), "free");
  assert.equal(formatPrice(0), "Free");
  assert.equal(formatPrice(1900), "$19");
  assert.equal(formatPrice(1950), "$19.50");
  assert.equal(planLimitMessage({ message: "Product limit reached", hint: "plan_limit:max_products" }), "Product limit reached");
  assert.equal(planLimitMessage({ message: "other", hint: null }), null);
});

test("AI key shape checks and hints", () => {
  assert.equal(checkKeyShape("anthropic", "  sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123  ").ok, true);
  assert.equal(checkKeyShape("anthropic", "sk-abcdefghijklmnopqrstuvwxyz").ok, false);
  assert.equal(checkKeyShape("openai", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz").ok, false);
  assert.equal(checkKeyShape("openai", "sk-proj-abcdefghijklmnopqrstuvwxyz0123").ok, true);
  assert.equal(checkKeyShape("gemini", "AIzaSyA-abcdefghijklmnopqrstuvwxyz012").ok, true);
  assert.equal(checkKeyShape("gemini", "has space in it abcdefghijklmnopqrstuvwxyz").ok, false);
  assert.equal(keyHint("sk-ant-xyz-abcd"), "abcd");
});

test("user-typed plain words default to ambiguous; distinctive terms don't", () => {
  for (const t of ["timer", "whiteboard", "notes"]) assert.equal(isAmbiguousCustomTerm(t), true, t);
  for (const t of ["Excalidraw", "excalidraw.com", "acme/focusflow", "@focusflow", "FocusFlow2"]) assert.equal(isAmbiguousCustomTerm(t), false, t);
});

test("integration catalog is honest", () => {
  // "available"/"unverified" must mean an adapter exists; everything else stays planned or blocked.
  assert.deepEqual(
    INTEGRATIONS.filter((i) => i.availability === "available" || i.availability === "unverified").map((i) => i.provider).sort(),
    [...PUBLIC_SOURCES].sort(),
    "only sources with an implemented adapter are marked available or unverified",
  );
  // Paid sources can't be "available" until validated against the live API.
  for (const i of INTEGRATIONS.filter((i) => i.paid)) assert.notEqual(i.availability, "available", i.provider);
  for (const i of INTEGRATIONS.filter((i) => i.availability === "blocked")) {
    assert.ok(i.blockedReason, `${i.provider} needs a blocked reason`);
  }
  const providers = INTEGRATIONS.map((i) => i.provider);
  assert.equal(new Set(providers).size, providers.length);
});

test("mention allowance warnings: 80 % warning, 90 % stronger, 100 % used up", () => {
  assert.deepEqual(mentionUsageLevel(79, 100), { percent: 79, level: "ok" });
  assert.deepEqual(mentionUsageLevel(80, 100), { percent: 80, level: "warning" });
  assert.deepEqual(mentionUsageLevel(13_500, 15_000), { percent: 90, level: "critical" });
  assert.deepEqual(mentionUsageLevel(100, 100), { percent: 100, level: "exhausted" });
  assert.deepEqual(mentionUsageLevel(120, 100), { percent: 100, level: "exhausted" }, "after a downgrade below consumption");
});

test("keyword allowance: per-workspace plan limit; onboarding suggestions beyond it start switched off", () => {
  assert.deepEqual(checkKeywordLimit({ name: "Pro", maxKeywords: 10 }, 4, 6), { allowed: true });
  const no = checkKeywordLimit({ name: "Free", maxKeywords: 1 }, 0, 2);
  assert.equal(no.allowed, false);
  assert.match((no as { message: string }).message, /Free plan includes 1 active keyword per workspace/);
  const fitted = fitSuggestionsToAllowance(
    [{ term: "Octolens", enabled: true }, { term: "octolens.com", enabled: true }, { term: "Octo", enabled: false }] as Array<{ term: string; enabled: boolean; reason?: string }>,
    { planName: "Free", max: 1, available: 1 },
  );
  assert.deepEqual(fitted.map((a) => a.enabled), [true, false, false]);
  assert.match(fitted[1]!.reason!, /Free plan includes 1 active keyword/);
});

test("plan rows carry keyword allowance, refresh target and retirement", () => {
  const scale = planFromRow({
    id: "scale", name: "Scale", description: null, price_cents_monthly: 30000, currency: "usd", max_products: 10, max_competitors_per_product: 5,
    monthly_mention_limit: 50000, history_days: 730, monitoring_interval_minutes: 60, monthly_ai_token_budget: "30000000", monthly_investigations: 40,
    features: {}, max_keywords: 40, keyword_refresh_target_minutes: 360, retired_at: null,
  });
  assert.deepEqual([scale.maxKeywords, scale.keywordRefreshTargetMinutes, scale.retired, formatPrice(scale.priceCentsMonthly)], [40, 360, false, "$300"]);
  const usage = usageFromRpc({ plan_id: "pro", plan_name: "Pro", mention_allowance: 15000, mentions_consumed: 12, mentions_remaining: 14988, max_keywords: 10 });
  assert.deepEqual([usage.mentionAllowance, usage.mentionsRemaining, usage.exhaustedAt], [15000, 14988, null]);
});

test("internal testing grants: take precedence while active, never a subscription", () => {
  const grant = { plan_id: "pro", reason: "internal_testing", expires_at: null, revoked_at: null };
  assert.equal(effectivePlanId(null, grant), "pro", "no subscription needed");
  assert.equal(effectivePlanId({ plan_id: "free", status: "active" }, grant), "pro");
  assert.equal(effectivePlanId({ plan_id: "free", status: "active" }, { ...grant, revoked_at: "2026-10-16T00:00:00Z" }), "free", "revoked → subscription");
  assert.equal(effectivePlanId(null, { ...grant, expires_at: "2020-01-01T00:00:00Z" }), "free", "expired → free");
});

test("the product name is always a monitored brand term", () => {
  const base = { kind: "custom", isAmbiguous: false, contextTerms: [] as string[], negativeTerms: [] as string[], source: "user" };
  const added = ensureBrandTerm([{ ...base, term: "acme cli", enabled: true }], "FixtureFlow");
  assert.equal(added.changed, true);
  assert.deepEqual(added.aliases.map((a) => [a.term, a.kind, a.enabled]), [["FixtureFlow", "exact_name", true], ["acme cli", "custom", true]]);

  const reenabled = ensureBrandTerm([{ ...base, term: "fixtureflow", enabled: false }], "FixtureFlow");
  assert.deepEqual(reenabled.aliases.map((a) => a.enabled), [true]);

  const kept = ensureBrandTerm([{ ...base, term: "FixtureFlow", enabled: true }], "FixtureFlow");
  assert.equal(kept.changed, false);

  // Ambiguous names without context stay off (they would match unrelated posts).
  const amb = ensureBrandTerm([{ ...base, term: "Notion", isAmbiguous: true, enabled: false }], "Notion");
  assert.equal(amb.changed, false);
  assert.equal(amb.aliases[0]!.enabled, false);
});

test("retargetBrandAliases follows a product rename and a new website", () => {
  const base = { isAmbiguous: false, contextTerms: ["alarm"], negativeTerms: [], enabled: true, source: "suggested" };
  const before = [
    { ...base, term: "Erly", kind: "exact_name" },
    { ...base, term: "erly.co", kind: "domain", enabled: false },
    { ...base, term: "wake up app", kind: "custom", source: "user" },
  ];
  const r = retargetBrandAliases(before, { name: "Erly", domain: "erly.co" }, { name: "toing", domain: "toingit.com" });
  assert.equal(r.changed, true);
  assert.deepEqual(r.aliases.map((a) => [a.term, a.kind, a.enabled]), [["toing", "exact_name", true], ["toingit.com", "domain", false], ["wake up app", "custom", true]]);
  assert.deepEqual(r.aliases[0]!.contextTerms, []);
  // Nothing renamed: unchanged.
  assert.equal(retargetBrandAliases(before, { name: "Erly", domain: "erly.co" }, { name: "erly", domain: "erly.co" }).changed, false);
  // New name already a keyword: the old one is dropped, no duplicate.
  const dup = retargetBrandAliases([...before, { ...base, term: "Toing", kind: "custom" }], { name: "Erly", domain: null }, { name: "toing", domain: null });
  assert.deepEqual(dup.aliases.map((a) => a.term).sort(), ["Toing", "erly.co", "wake up app"].sort());
  // Old name wasn't a keyword: the new name is still added as the brand term.
  const add = retargetBrandAliases([before[2]!], { name: "Erly", domain: null }, { name: "toing", domain: null });
  assert.equal(add.aliases[0]!.term, "toing");
});
