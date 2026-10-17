import { expect, test } from "@playwright/test";
import { createUser, createWorkspaceWithProduct, deleteUser, seedMentions, signInPath, type TestUser } from "./support";

// Reports are computed from stored data (no API or AI calls): numbers here must
// match the seeded fixtures exactly.

let user: TestUser | null = null;
let ids = { workspaceId: "", productId: "" };

test.beforeEach(async () => {
  user = await createUser();
  ids = await createWorkspaceWithProduct(user);
});

test.afterEach(async () => {
  if (user) await deleteUser(user.id);
  user = null;
});

test("empty product: no report is made from nothing", async ({ page }) => {
  await page.goto(await signInPath(user!.email, "/reports"));
  const main = page.locator("#main");
  await expect(main.getByText("No reports yet")).toBeVisible();
  await main.getByRole("button", { name: "Report for the last 7 days" }).click();
  await expect(main.getByText("Nothing was monitored in the last 7 days")).toBeVisible();
});

test("last-7-days report: numbers match stored data, week-over-week change, highlights, CSV download", async ({ page }) => {
  // This week: 6 relevant (4 Hacker News, 2 GitHub) + 1 irrelevant; the week before: 3 relevant.
  await seedMentions(ids.productId, ids.workspaceId, [
    { source: "hackernews", externalId: "r-1", title: "FixtureFlow is fast", hoursAgo: 10, author: "a" },
    { source: "hackernews", externalId: "r-2", title: "FixtureFlow release", hoursAgo: 30, author: "b" },
    { source: "hackernews", externalId: "r-3", title: "Using FixtureFlow", hoursAgo: 50, author: "c" },
    { source: "hackernews", externalId: "r-4", title: "FixtureFlow tips", hoursAgo: 70, author: "a" },
    { source: "github", externalId: "r-5", title: "FixtureFlow issue", hoursAgo: 90, author: "d" },
    { source: "github", externalId: "r-6", title: "FixtureFlow PR", hoursAgo: 110, author: "e" },
    { source: "github", externalId: "r-x", title: "Unrelated fixture", hoursAgo: 20, status: "irrelevant" },
    { source: "hackernews", externalId: "p-1", title: "FixtureFlow old", hoursAgo: 24 * 8, author: "f" },
    { source: "hackernews", externalId: "p-2", title: "FixtureFlow older", hoursAgo: 24 * 9, author: "g" },
    { source: "github", externalId: "p-3", title: "FixtureFlow oldest", hoursAgo: 24 * 10, author: "h" },
  ], 30);

  await page.goto(await signInPath(user!.email, "/reports"));
  const main = page.locator("#main");
  await main.getByRole("button", { name: "Report for the last 7 days" }).click();
  await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("FixtureFlow");

  const kpi = main.getByTestId("report-kpi").filter({ hasText: "Relevant mentions" });
  await expect(kpi).toContainText("6");
  await expect(main.getByTestId("report-highlights")).toContainText("6 relevant mentions");
  await expect(main.getByTestId("report-highlights")).toContainText("Most mentions came from Hacker News (67%)");
  await expect(main.getByRole("row", { name: /Hacker News 4 67%/ })).toBeVisible();
  await expect(main.getByRole("row", { name: /GitHub 2 33%/ })).toBeVisible();
  await expect(main.getByTestId("report-kpi").filter({ hasText: "Unique authors" })).toContainText("5");

  const [download] = await Promise.all([page.waitForEvent("download"), main.getByRole("link", { name: "Download CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^FixtureFlow-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  expect(csv).toContain("relevant_mentions,6,3");
  expect(csv).toContain("Hacker News,4");

  await page.goto("/reports");
  await expect(main.getByTestId("reports").getByRole("listitem")).toHaveCount(1);
  await expect(main.getByTestId("reports")).toContainText("6 mentions");
});
