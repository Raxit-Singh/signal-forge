import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeWebsiteUrl, parseGithubRepo, parseAppStoreUrl, parsePlayStoreUrl, safeRedirectPath,
} from "./urls.ts";
import { suggestAliases, isAmbiguousTerm, isAmbiguousCustomTerm, splitWords, contextKeywords } from "./aliases.ts";
import { checkProductLimit, effectivePlanId, formatPrice, planFromRow, planLimitMessage } from "./plans.ts";
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
});

test("parsePlayStoreUrl extracts package name", () => {
  const r = parsePlayStoreUrl("https://play.google.com/store/apps/details?id=com.acme.focusflow&hl=en");
  assert.ok(r.ok);
  assert.equal(r.value.packageName, "com.acme.focusflow");
  assert.equal(parsePlayStoreUrl("https://play.google.com/store/apps/details?id=nodots").ok, false);
  assert.equal(parsePlayStoreUrl("https://evil.com/?id=com.acme.app").ok, false);
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
