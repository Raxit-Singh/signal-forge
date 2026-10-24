import { expect, test } from "@playwright/test";
import {
  adminInsert, createUser, createWorkspaceWithProduct, deleteUser, seedMentions, signInPath, type FixtureMention, type TestUser,
} from "./support";

// Deterministic fixtures (clearly synthetic: e2e-* ids, example.com links). Monitoring covered the last 10 days only,
// so everything before that must show as "not monitored", not zero.
let user: TestUser | null = null;
let ids = { workspaceId: "", productId: "" };

const FIXTURES: FixtureMention[] = [
  ...Array.from({ length: 6 }, (_, i) => ({ source: "hackernews" as const, externalId: `e2e-b-hn-${i}`, title: `FixtureFlow thread ${i}`, hoursAgo: 2 + i * 30, author: `hn${i % 3}` })),
  ...Array.from({ length: 4 }, (_, i) => ({ source: "bluesky" as const, externalId: `e2e-b-bs-${i}`, title: `FixtureFlow post ${i}`, hoursAgo: 5 + i * 40, author: `bs${i}`, type: i % 2 ? "reply" as const : "post" as const })),
  { source: "bluesky", externalId: "e2e-b-bs-x", title: "Unrelated flow chart", hoursAgo: 6, status: "irrelevant" },
  // Two HN items sharing a link: the second is a repost and must not be counted.
  { source: "hackernews", externalId: "e2e-b-hn-orig", title: "FixtureFlow 2.0", hoursAgo: 50, linkedUrl: "fixtureflow.example/v2" },
  { source: "hackernews", externalId: "e2e-b-hn-repost", title: "FixtureFlow 2.0 is out", hoursAgo: 49, linkedUrl: "fixtureflow.example/v2" },
];

test.beforeEach(async ({ page }) => {
  user = await createUser();
  ids = await createWorkspaceWithProduct(user);
  await seedMentions(ids.productId, ids.workspaceId, FIXTURES, 10);
  await page.goto(await signInPath(user.email, "/buzz"));
  await expect(page).toHaveURL(/\/buzz$/);
});

test.afterEach(async () => {
  if (user) await deleteUser(user.id);
  user = null;
});

const kpi = (page: import("@playwright/test").Page, label: string) =>
  page.locator("div", { has: page.getByText(label, { exact: true }) }).last();

test("buzz analytics shows counts derived from stored mentions, excluding reposts", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Trends", exact: true })).toBeVisible();
  // 6 HN + 4 Bluesky + 1 HN original = 11 relevant; the repost and the irrelevant post are excluded.
  await expect(kpi(page, "Mentions · last 30 days")).toContainText("11");
  await expect(kpi(page, "Mentions · last 30 days")).toContainText("1 duplicate/repost not counted");
  await expect(kpi(page, "Unique authors")).toContainText("7");
  const dist = page.getByRole("list", { name: "Mentions by platform" });
  await expect(dist).toContainText("Hacker News");
  await expect(dist).toContainText("7 · 64%");
  await expect(dist).toContainText("Bluesky");
  await expect(dist).toContainText("4 · 36%");
  // 2 of the 11 relevant mentions are Bluesky replies.
  await expect(page.getByRole("list", { name: "Mentions by type" })).toContainText("Comments & replies2 · 18%");
});

const graph = (page: import("@playwright/test").Page) => page.getByTestId("spike-graph");
const day = (n: number) => new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000 - n * 86_400_000).toISOString();

test("the graph starts when monitoring started; counts use publication time, not when they were collected", async ({ page }) => {
  await expect(graph(page)).toBeVisible();
  // Days before monitoring aren't drawn as zeros: the graph starts at the first monitored day and says so.
  await expect(page.getByTestId("graph-starts")).toContainText("Monitoring started");
  await page.getByText("Show as table").click();
  const rows = page.locator("table tbody tr");
  await expect(rows.last()).not.toContainText("no data");
  await expect(page.getByText("Shaded periods weren't (fully) monitored")).toBeVisible();
  // Every fixture was inserted just now but published over 10 days: they are spread out, not piled into today.
  const counts = (await rows.locator("td:nth-child(2)").allInnerTexts()).map((t) => Number.parseInt(t, 10)).filter((n) => !Number.isNaN(n));
  expect(counts.reduce((a, b) => a + b, 0)).toBe(11);
  expect(Math.max(...counts)).toBeLessThan(11);
});

test("one graph: spike markers, hover details, a details panel, and filters that update the same graph", async ({ page }) => {
  await adminInsert("buzz_spikes", {
    workspace_id: ids.workspaceId, product_id: ids.productId, platform: null, granularity: "day", period_start: day(1), period_end: day(0),
    observed: 30, expected: 4, baseline_periods: 20, robust_z: 9, ratio: 7.5, severity: "major", confidence: "confirmed",
  });
  await adminInsert("buzz_spikes", {
    workspace_id: ids.workspaceId, product_id: ids.productId, platform: null, granularity: "day", period_start: day(5), period_end: day(4),
    observed: 3, expected: 1, baseline_periods: 4, robust_z: 3, ratio: 3, severity: "notable", confidence: "possible",
    note: "This period was only partly monitored, so the count may be incomplete.",
  });
  await adminInsert("buzz_spikes", {
    workspace_id: ids.workspaceId, product_id: ids.productId, platform: "bluesky", granularity: "day", period_start: day(2), period_end: day(1),
    observed: 3, expected: 0.5, baseline_periods: 20, robust_z: 5, ratio: 6, severity: "notable", confidence: "confirmed",
  });
  await page.reload();
  // No separate spike list or extra charts: one graph with distinct confirmed / possible markers.
  await expect(page.getByRole("list", { name: "Detected spikes" })).toHaveCount(0);
  await expect(page.getByTestId("spike-graph")).toHaveCount(1);
  await expect(page.getByTestId("spike-marker-confirmed")).toHaveCount(1);
  await expect(page.getByTestId("spike-marker-possible")).toHaveCount(1);

  await page.getByTestId("spike-marker-confirmed").hover();
  const tip = page.getByTestId("spike-tooltip");
  await expect(tip).toContainText("Confirmed spike · All platforms");
  await expect(tip).toContainText("~4.0");
  await expect(tip).toContainText("7.5× usual");

  await page.getByTestId("spike-marker-confirmed").click();
  const panel = page.getByRole("dialog", { name: "Confirmed spike" });
  await expect(panel.getByTestId("spike-panel")).toContainText("30");
  await expect(panel.getByTestId("spike-panel")).toContainText("Major");
  await expect(panel.getByRole("list", { name: "Contributing platforms" })).toContainText("Hacker News");
  await expect(panel.getByRole("list", { name: "Contributing keywords" })).toContainText("FixtureFlow");
  await expect(panel.getByRole("list", { name: "Relevant mentions" }).getByRole("link").first()).toHaveAttribute("href", /https:\/\/example\.com\/e2e\//);
  // Explanations are only made on request.
  await expect(panel.getByRole("button", { name: "Explain with AI" })).toBeVisible();
  await panel.getByRole("button", { name: "Close" }).click();

  await page.getByTestId("spike-marker-possible").click();
  await expect(page.getByRole("dialog", { name: "Possible spike" })).toContainText("only partly monitored");
  await page.keyboard.press("Escape");

  // Platform filter: same graph, that platform's counts and spikes (the KPIs follow too).
  await page.getByRole("button", { name: /^Show:/ }).click();
  await page.getByRole("menuitemradio", { name: "Bluesky", exact: true }).click();
  await expect(page).toHaveURL(/source=bluesky/);
  await expect(kpi(page, "Mentions · last 30 days")).toContainText("4");
  await expect(page.getByTestId("spike-graph")).toHaveCount(1);
  await expect(page.getByTestId("spike-marker-confirmed")).toHaveCount(1);
  await expect(page.getByTestId("spike-marker-possible")).toHaveCount(0);

  // Keyword filter replaces the platform filter.
  await page.getByRole("button", { name: /^Show:/ }).click();
  await page.getByRole("menuitemradio", { name: "FixtureFlow", exact: true }).click();
  await expect(page).toHaveURL(/keyword=FixtureFlow/);
  await expect(page).not.toHaveURL(/source=/);
  await expect(page.getByText("this graph shows only this keyword")).toBeVisible();
  await expect(page.getByTestId("spike-marker-confirmed")).toHaveCount(0);

  // Time range: presets and a custom range update the same graph.
  await page.getByRole("group", { name: "Graph filters" }).getByRole("radio", { name: "7d" }).click();
  await expect(page).toHaveURL(/range=7d/);
  await expect(page).toHaveURL(/keyword=FixtureFlow/);
  await page.getByRole("group", { name: "Graph filters" }).getByRole("radio", { name: "Custom" }).click();
  const f = page.getByRole("group", { name: "Graph filters" });
  await f.getByLabel("From").fill(day(9).slice(0, 10));
  await f.getByLabel("To").fill(day(0).slice(0, 10));
  await f.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/range=custom/);
  await expect(page.getByTestId("spike-graph")).toHaveCount(1);
});

test("insufficient baseline: the graph still shows observed activity with a short notice; no fabricated spikes", async ({ page }) => {
  await adminInsert("spike_evaluations", {
    product_id: ids.productId, workspace_id: ids.workspaceId, scope: "product", scope_key: "", granularity: "day",
    status: "insufficient_data", baseline_periods: 2, needed_periods: 3,
  });
  await page.reload();
  await expect(page.getByTestId("spike-graph")).toBeVisible();
  await expect(page.getByTestId("spike-insufficient")).toContainText("Spike confidence is still developing: 2 of 3 completely monitored days");
  await expect(page.getByTestId("spike-marker-confirmed")).toHaveCount(0);
  await expect(page.getByTestId("spike-marker-possible")).toHaveCount(0);
});

test("empty period: no graph is drawn from nothing", async ({ page }) => {
  await page.goto(`/buzz?range=custom&from=${day(80).slice(0, 10)}&to=${day(60).slice(0, 10)}`);
  await expect(page.getByText("No monitoring data in this period")).toBeVisible();
  await expect(page.getByTestId("spike-graph")).toHaveCount(0);
});

test("mobile: the graph and spike panel fit a phone screen", async ({ page }) => {
  await adminInsert("buzz_spikes", {
    workspace_id: ids.workspaceId, product_id: ids.productId, platform: null, granularity: "day", period_start: day(1), period_end: day(0),
    observed: 30, expected: 4, baseline_periods: 20, robust_z: 9, ratio: 7.5, severity: "major", confidence: "confirmed",
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.getByTestId("spike-graph")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.getByRole("list", { name: "Spikes in this period" }).getByRole("listitem").first().click();
  const panel = page.getByRole("dialog", { name: "Confirmed spike" });
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(375);
});
