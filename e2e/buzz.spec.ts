import { expect, test } from "@playwright/test";
import {
  adminInsert, adminSelect, createUser, createWorkspaceWithProduct, deleteUser, seedMentions, signInPath, type FixtureMention, type TestUser,
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
  await expect(page.getByRole("heading", { name: "Buzz Analytics" })).toBeVisible();
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

test("days before monitoring started are gaps, not zeros; data table matches", async ({ page }) => {
  await page.getByText("Show as table").click();
  const rows = page.locator("table tbody tr");
  await expect(rows.first()).toContainText("no data");
  const last = rows.last();
  await expect(last).not.toContainText("no data");
  await expect(page.getByText("Grey periods weren't monitored")).toBeVisible();
});

test("relevant vs not relevant view, platform filter and stored spikes", async ({ page }) => {
  await page.getByRole("radio", { name: "Relevant vs not relevant" }).click();
  await expect(page.getByRole("radio", { name: "Relevant vs not relevant" })).toHaveAttribute("aria-checked", "true");

  await page.getByLabel("Platform", { exact: true }).selectOption("bluesky");
  await expect(page).toHaveURL(/source=bluesky/);
  await expect(kpi(page, "Mentions · last 30 days")).toContainText("4");

  await adminInsert("buzz_spikes", {
    workspace_id: ids.workspaceId, product_id: ids.productId, platform: null, granularity: "day",
    period_start: new Date(Date.now() - 86_400_000).toISOString(), period_end: new Date().toISOString(),
    observed: 30, expected: 4, baseline_periods: 20, robust_z: 9, ratio: 7.5, severity: "major",
  });
  await page.reload();
  const spikes = page.getByRole("list", { name: "Detected spikes" });
  await expect(spikes).toContainText("30 mentions vs ~4.0 usual");
  await expect(spikes).toContainText("Major");
});

test("smart monitoring: mode, per-platform schedule, and a Launch Boost that returns to normal", async ({ page }) => {
  await page.goto("/monitoring");
  await expect(page.getByRole("heading", { name: "Smart Monitoring" })).toBeVisible();
  const monitored = page.getByRole("list", { name: "Monitored platforms" });
  await expect(monitored).toContainText("Hacker News");
  // Paid sources are off on a server without API Direct credentials, and say why.
  await expect(page.getByRole("list", { name: "Other platforms" })).toContainText("Reddit");
  await expect(page.getByRole("list", { name: "Other platforms" })).toContainText(/Not configured on this server|switched off/);

  await page.getByRole("radio", { name: /Eco/ }).check();
  await page.getByRole("button", { name: "Save mode" }).click();
  await expect(page.getByText("Monitoring mode saved")).toBeVisible();
  await expect.poll(() => adminSelect<Array<{ monitoring_mode: string }>>(`products?id=eq.${ids.productId}&select=monitoring_mode`).then((r) => r[0]?.monitoring_mode)).toBe("eco");

  await page.getByLabel("Name").fill("E2E launch");
  await page.getByRole("checkbox", { name: /Hacker News/ }).check();
  await page.getByRole("button", { name: "Schedule boost" }).click();
  await expect(page.getByText("Launch Boost scheduled")).toBeVisible();
  const boosts = page.getByRole("list", { name: "Active and upcoming boosts" });
  await expect(boosts).toContainText("E2E launch");
  await boosts.getByRole("button", { name: "Cancel" }).click();
  await expect(boosts).toHaveCount(0);
  await expect(page.getByText(/Recent: E2E launch \(canceled/)).toBeVisible();
  await expect.poll(() => adminSelect<Array<{ canceled_at: string | null }>>(`launch_boosts?product_id=eq.${ids.productId}&select=canceled_at`).then((r) => Boolean(r[0]?.canceled_at))).toBe(true);
});
