import { expect, test } from "@playwright/test";
import {
  createUser, createWorkspaceWithProduct, deleteUser, seedMentions, signInPath, type FixtureMention, type TestUser,
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

const graph = (page: import("@playwright/test").Page) => page.getByTestId("trend-graph");
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

test("one graph: platform, keyword and time-range filters update the same graph", async ({ page }) => {
  await expect(graph(page)).toHaveCount(1);
  // Platform filter: same graph, that platform's counts (the numbers above follow too).
  await page.getByRole("button", { name: /^Show:/ }).click();
  await page.getByRole("menuitemradio", { name: "Bluesky", exact: true }).click();
  await expect(page).toHaveURL(/source=bluesky/);
  await expect(kpi(page, "Mentions · last 30 days")).toContainText("4");
  await expect(graph(page)).toHaveCount(1);
  // Every platform stays selectable after choosing one.
  await page.getByRole("button", { name: /^Show:/ }).click();
  await page.getByRole("menuitemradio", { name: "Hacker News", exact: true }).click();
  await expect(page).toHaveURL(/source=hackernews/);
  await expect(kpi(page, "Mentions · last 30 days")).toContainText("7");

  // Keyword filter replaces the platform filter.
  await page.getByRole("button", { name: /^Show:/ }).click();
  await page.getByRole("menuitemradio", { name: "FixtureFlow", exact: true }).click();
  await expect(page).toHaveURL(/keyword=FixtureFlow/);
  await expect(page).not.toHaveURL(/source=/);
  await expect(page.getByText("this graph shows only this keyword")).toBeVisible();

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
  await expect(graph(page)).toHaveCount(1);
});

test("empty period: no graph is drawn from nothing", async ({ page }) => {
  await page.goto(`/buzz?range=custom&from=${day(80).slice(0, 10)}&to=${day(60).slice(0, 10)}`);
  await expect(page.getByText("No monitoring data in this period")).toBeVisible();
  await expect(graph(page)).toHaveCount(0);
});

test("mobile: the graph fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(graph(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
