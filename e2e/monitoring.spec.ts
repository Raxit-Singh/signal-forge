import { expect, test } from "@playwright/test";
import {
  adminInsert, adminSelect, adminUpdate, createUser, createWorkspaceWithProduct, deleteUser, seedMentions, signInPath, type FixtureMention, type TestUser,
} from "./support";

// Automatic Smart Monitoring. Synthetic fixtures only; no source is ever called.
// The e2e workspace is on the Free plan (checks at most every 24 h; boosts down to 6 h).
let user: TestUser | null = null;
let ids = { workspaceId: "", productId: "" };

const FIXTURES: FixtureMention[] = [
  ...Array.from({ length: 12 }, (_, i) => ({ source: "hackernews" as const, externalId: `e2e-m-hn-${i}`, title: `FixtureFlow thread ${i}`, hoursAgo: 2 + i * 12, author: `hn${i}` })),
  { source: "github", externalId: "e2e-m-gh-1", title: "FixtureFlow export bug", hoursAgo: 30 },
];

test.beforeEach(async ({ page }) => {
  user = await createUser();
  ids = await createWorkspaceWithProduct(user);
  await seedMentions(ids.productId, ids.workspaceId, FIXTURES, 30);
  await page.goto(await signInPath(user.email, "/monitoring"));
  await expect(page).toHaveURL(/\/monitoring$/);
});

test.afterEach(async () => {
  if (user) await deleteUser(user.id);
  user = null;
});

const ranking = (page: import("@playwright/test").Page) => page.getByRole("table", { name: "Platform ranking" });

/** Scheduling diagnostics live behind "Advanced details". */
async function openAdvanced(page: import("@playwright/test").Page) {
  const adv = page.locator("details#advanced");
  if (!(await adv.evaluate((d: HTMLDetailsElement) => d.open))) await adv.locator("summary").first().click();
}

test("simple view: summary, keywords and platforms ranked by mention count, no technical settings up front", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Smart Monitoring", level: 1 })).toBeVisible();
  for (const mode of ["Eco", "Balanced", "Priority"]) await expect(page.getByRole("radio", { name: new RegExp(mode) })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save mode" })).toHaveCount(0);
  // Formula-level detail is hidden until "Advanced details" is opened.
  await expect(page.getByText("Checks avoided vs hourly", { exact: true })).toBeHidden();

  const stat = (label: string) => page.locator("div", { has: page.getByText(label, { exact: true }) }).last();
  await expect(stat("Total mentions · last 30 days")).toContainText("13");
  await expect(stat("Active platforms")).toContainText("3");
  await expect(stat("Keywords monitored")).toContainText("1");

  // Platforms: ranked by unique relevant mentions; Stack Overflow was never scanned, so it has no rank (not "0").
  const table = page.getByRole("table", { name: "Overall platform performance" });
  const rows = table.getByRole("row");
  await expect(rows.nth(1)).toContainText("Hacker News");
  await expect(rows.nth(1)).toContainText("12");
  await expect(rows.nth(1)).toContainText("92%");
  await expect(rows.nth(2)).toContainText("GitHub");
  await expect(rows.nth(3)).toContainText("Stack Overflow");
  await expect(rows.nth(3)).toContainText("Not scanned yet");
  await expect(rows.nth(3).getByRole("cell").first()).toHaveText("–");

  // Keyword: total, best platform; expanding shows that keyword's own platform ranking.
  const keywords = page.getByRole("list", { name: "Keyword performance" });
  await expect(keywords).toContainText("FixtureFlow");
  await expect(keywords).toContainText("13 mentions");
  await expect(keywords).toContainText("Best: Hacker News");
  await keywords.getByText("FixtureFlow", { exact: true }).click();
  const perPlatform = page.getByRole("list", { name: "FixtureFlow platform ranking" });
  await expect(perPlatform.getByRole("listitem").nth(0)).toContainText("1.Hacker News");
  await expect(perPlatform.getByRole("listitem").nth(1)).toContainText("2.GitHub");
  await expect(perPlatform.getByRole("listitem").nth(2)).toContainText("Not scanned yet");

  // The reporting period changes the window: a 7-day view only counts what was published in it.
  await page.goto("/monitoring?range=7d");
  await expect(stat("Total mentions · last 7 days")).toContainText("13");

  // Scheduling detail is still available for those who want it.
  await openAdvanced(page);
  await expect(page.getByText("Your Free plan checks each platform at most every 24 h", { exact: false }).first()).toBeVisible();
  const avoided = page.locator("div", { has: page.getByText("Checks avoided vs hourly", { exact: true }) }).last();
  await expect(avoided).toContainText("—");
  const coverage = page.getByRole("list", { name: "Keyword coverage" });
  await expect(coverage).toContainText("Searched on 3 of 3 platforms");
  await coverage.getByText("FixtureFlow", { exact: true }).click();
  const byPlatform = page.getByRole("list", { name: "FixtureFlow by platform" });
  await expect(byPlatform.getByRole("listitem").filter({ hasText: "Hacker News" })).toContainText("every 24 h");
  await expect(byPlatform.getByRole("listitem").filter({ hasText: "Stack Overflow" })).toContainText("Searched every check");
  const other = page.getByRole("list", { name: "Other platforms" });
  await expect(other).toContainText("Reddit");
  await expect(other).toContainText(/Not configured on this server|switched off/);
});

test("each keyword has its own platform ranking; growth is shown but doesn't change rank", async ({ page }) => {
  await adminInsert("internal_plan_grants", {
    workspace_id: ids.workspaceId, plan_id: "pro", reason: "development", granted_by: "e2e-monitoring", expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  await adminInsert("product_aliases", { workspace_id: ids.workspaceId, product_id: ids.productId, term: "Flowctl", kind: "custom", enabled: true, source: "user" });
  // Flowctl: GitHub 3 > Hacker News 1. FixtureFlow: Hacker News 12 > GitHub 1 (fixtures). Two posts match both keywords.
  await seedMentions(ids.productId, ids.workspaceId, [
    { source: "github", externalId: "e2e-k-gh-1", title: "flowctl crash", hoursAgo: 5, terms: ["Flowctl"] },
    { source: "github", externalId: "e2e-k-gh-2", title: "flowctl and FixtureFlow", hoursAgo: 6, terms: ["Flowctl", "FixtureFlow"] },
    { source: "github", externalId: "e2e-k-gh-3", title: "flowctl docs", hoursAgo: 7, terms: ["flowctl"] },
    { source: "hackernews", externalId: "e2e-k-hn-1", title: "Show HN: flowctl", hoursAgo: 8, terms: ["Flowctl"] },
    // Previous 30 days: GitHub grew from 1, Hacker News had 10 (so HN shrank) — ranks still follow counts.
    { source: "hackernews", externalId: "e2e-k-hn-old", title: "old", hoursAgo: 24 * 40, terms: ["FixtureFlow"] },
  ], 70);
  await page.reload();

  const keywords = page.getByRole("list", { name: "Keyword performance" });
  await keywords.getByText("Flowctl", { exact: true }).click();
  const flow = page.getByRole("list", { name: "Flowctl platform ranking" });
  await expect(flow.getByRole("listitem").nth(0)).toContainText("1.GitHub");
  await expect(flow.getByRole("listitem").nth(0)).toContainText("3");
  await expect(flow.getByRole("listitem").nth(1)).toContainText("2.Hacker News");

  // FixtureFlow keeps Hacker News first; the shared post counts for both keywords...
  await expect(keywords.getByRole("listitem").filter({ hasText: "FixtureFlow" }).first()).toContainText("14 mentions");
  await expect(keywords.getByRole("listitem").filter({ hasText: "Flowctl" }).first()).toContainText("4 mentions");
  // ...but only once in the platform totals (12 + 1 + 4 new GitHub/HN posts = 17 unique).
  const stat = (label: string) => page.locator("div", { has: page.getByText(label, { exact: true }) }).last();
  await expect(stat("Total mentions · last 30 days")).toContainText("17");
  // Hacker News: 13 now vs 1 before (+1200%); GitHub: 4 vs 0 (no growth figure). Hacker News still ranks by count.
  const rows = page.getByRole("table", { name: "Overall platform performance" }).getByRole("row");
  await expect(rows.nth(1)).toContainText("Hacker News");
  await expect(rows.nth(1)).toContainText("+1200%");
  await expect(rows.nth(2)).toContainText("GitHub");
});

test("ranking from stored activity, explanations, and a Launch Boost that returns to automatic intervals", async ({ page }) => {
  // Enough completed checks for Hacker News to leave discovery (GitHub stays new).
  for (const daysAgo of [2, 1]) {
    await adminInsert("coverage_windows", {
      workspace_id: ids.workspaceId, product_id: ids.productId, provider: "hackernews", status: "complete",
      window_start: new Date(Date.now() - (daysAgo + 1) * 86_400_000).toISOString(), window_end: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    });
  }
  // The arrival-rate engine learns from checks: 3 observed checks over 3 days (about 2 results/day, all relevant).
  const [hnQuery] = await adminSelect<Array<{ id: string }>>(`monitoring_queries?product_id=eq.${ids.productId}&provider=eq.hackernews&select=id`);
  await adminInsert("arrival_estimates", {
    query_id: hnQuery!.id, workspace_id: ids.workspaceId, product_id: ids.productId, platform: "hackernews", stream: "default",
    raw_alpha: 6.5, raw_beta: 73, rel_alpha: 6.5, rel_beta: 73, observations: 3, exposure_hours: 72, last_observed_at: new Date().toISOString(),
  });
  // Starting a boost now re-ranks the product from stored data (no API calls).
  await page.getByLabel("Name").fill("E2E launch");
  await page.getByRole("checkbox", { name: /Hacker News/ }).check();
  await page.getByRole("button", { name: "Schedule boost" }).click();
  await expect(page.getByText("Launch Boost scheduled")).toBeVisible();

  await expect.poll(() => adminSelect<Array<{ platform: string; phase: string; rank: number | null; mentions_7d: number; interval_minutes: number }>>(
    `platform_activity?product_id=eq.${ids.productId}&select=platform,phase,rank,mentions_7d,interval_minutes&order=platform`,
  ).then((r) => r.map((x) => `${x.platform}:${x.phase}:${x.rank}:${x.mentions_7d}:${x.interval_minutes}`).join(" "))).toContain("hackernews:ranked:1:12:360");

  await page.reload();
  await openAdvanced(page);
  const hn = ranking(page).getByRole("row").filter({ hasText: "Hacker News" });
  await expect(hn).toContainText("#1");
  await expect(hn).toContainText("%"); // share of this product's relevant mentions
  await expect(hn).toContainText("12");
  await expect(hn).toContainText("6 h");
  const gh = ranking(page).getByRole("row").filter({ hasText: "GitHub" });
  await expect(gh).toContainText("New");
  await expect(gh).toContainText("Learning");
  await expect(ranking(page)).toContainText("New platforms (learning, not ranked yet)");

  await hn.getByRole("button", { name: "Hacker News" }).click();
  await expect(hn.getByRole("button", { name: "Hacker News" })).toHaveAttribute("aria-expanded", "true");
  const details = page.locator("#details-hackernews");
  await expect(details).toContainText("Hacker News ranks #1");
  await expect(details).toContainText("12 relevant mentions in the last 7 days");
  await expect(details).toContainText("Hacker News is checked every 6 h because a Launch Boost is active.");
  await expect(details).toContainText("Your Free plan checks each platform at most every 24 h");
  await expect(details).toContainText("of this product's relevant mentions over the last 4 weeks");
  await expect(details.getByRole("list", { name: "Hacker News measured signals" })).toContainText("Important feedback");
  await expect(details.getByRole("list", { name: "Hacker News measured signals" })).toContainText("not measured");
  await expect(details).toContainText("Searched: FixtureFlow");

  // Cancel: back to the automatic interval (the Free plan's 24 h), and the change is logged with reasons.
  const boosts = page.getByRole("list", { name: "Active and upcoming boosts" });
  await boosts.getByRole("button", { name: "Cancel" }).click();
  await expect(boosts).toHaveCount(0);
  await expect.poll(() => adminSelect<Array<{ interval_minutes: number }>>(`platform_activity?product_id=eq.${ids.productId}&platform=eq.hackernews&select=interval_minutes`)
    .then((r) => r[0]?.interval_minutes)).toBe(1440);
  const changes = await adminSelect<Array<{ from_minutes: number; to_minutes: number; reasons: string[] }>>(
    `monitoring_interval_changes?product_id=eq.${ids.productId}&platform=eq.hackernews&select=from_minutes,to_minutes,reasons`,
  );
  assert(changes.some((c) => c.from_minutes === 360 && c.to_minutes === 1440 && c.reasons.length > 0), "interval change recorded with reasons");
  await page.reload();
  await openAdvanced(page);
  await expect(ranking(page).getByRole("row").filter({ hasText: "Hacker News" })).toContainText("24 h");
  await expect(page.locator("div", { has: page.getByText("Interval adjustments (7 days)", { exact: true }) }).last()).toContainText("1");
});

test("dashboard shows each keyword's actual scheduled refresh, not only the platform interval", async ({ page }) => {
  // Stack Overflow checked every 24 h, but its FixtureFlow search takes turns with another one (2 turns): every 2 days.
  await adminInsert("platform_activity", {
    product_id: ids.productId, workspace_id: ids.workspaceId, platform: "stackexchange", phase: "ranked", score: 30, rank: 1,
    trend: "stable", coverage_confidence: "high", recommended_interval: 1440, interval_minutes: 1440, reasons: ["Activity score 30/100"],
    keyword_target_minutes: 1440, slowest_keyword_minutes: 2880,
    keyword_conflict: "Keyword refresh target (24 h) not met on Stack Overflow: each keyword is searched every 2 days because keywords take turns.",
  });
  await adminUpdate(`monitoring_queries?product_id=eq.${ids.productId}&provider=eq.stackexchange`, {
    interval_minutes: 2880, params: { terms: ["FixtureFlow"], role: "brand", rotation: { position: 0, rotating: 2, slots: 1 } },
  });
  await page.reload();
  await openAdvanced(page);
  const so = ranking(page).getByRole("row").filter({ hasText: "Stack Overflow" });
  await expect(so).toContainText("24 h");
  await expect(so).toContainText("keywords every 2 days");
  await so.getByRole("button", { name: "Stack Overflow" }).click();
  await expect(page.locator("#details-stackexchange")).toContainText("each keyword is searched every 2 days");

  const coverage = page.getByRole("list", { name: "Keyword coverage" });
  await expect(coverage).toContainText("Every 24 h – 2 days");
  await coverage.getByText("FixtureFlow", { exact: true }).click();
  const byPlatform = page.getByRole("list", { name: "FixtureFlow by platform" });
  await expect(byPlatform.getByRole("listitem").filter({ hasText: "Stack Overflow" })).toContainText("every 2 days");
  await expect(byPlatform.getByRole("listitem").filter({ hasText: "Stack Overflow" })).not.toContainText("(est.)");
  await expect(page.getByRole("list", { name: "Keyword schedule conflicts" })).toContainText("not met on Stack Overflow");
});

test("mobile: rankings become cards with no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.getByRole("list", { name: "Overall platform performance" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Overall platform performance" })).toBeHidden();
  await openAdvanced(page);
  const cards = page.getByRole("list", { name: "Platform ranking" });
  await expect(cards).toBeVisible();
  await expect(page.getByRole("table", { name: "Platform ranking" })).toBeHidden();
  const card = cards.getByRole("listitem").filter({ hasText: "Hacker News" });
  await card.getByRole("button").first().click();
  await expect(card).toContainText("Why this interval");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

function assert(cond: boolean, message: string): asserts cond {
  if (!cond) throw new Error(message);
}
