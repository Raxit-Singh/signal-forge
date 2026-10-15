import { expect, test } from "@playwright/test";
import {
  createUser, createWorkspaceWithProduct, deleteUser, readMention, seedMentions, signInPath, type FixtureMention, type TestUser,
} from "./support";

let user: TestUser | null = null;
let productId = "";

// 27 HN fixtures + 2 GitHub + 1 Stack Exchange = 30 mentions, newest first by hoursAgo.
const FIXTURES: FixtureMention[] = [
  ...Array.from({ length: 27 }, (_, i) => ({
    source: "hackernews" as const, externalId: `e2e-hn-${i}`, title: `FixtureFlow HN post ${i}`, hoursAgo: i + 1,
  })),
  { source: "github", externalId: "e2e-gh-1", title: "FixtureFlow crashes on export", content: "Steps to reproduce: open FixtureFlow", hoursAgo: 0.5, url: "https://github.com/e2e/fixtureflow/issues/1" },
  { source: "github", externalId: "e2e-gh-2", title: "FixtureFlow dark mode request", hoursAgo: 40 },
  { source: "stackexchange", externalId: "stackoverflow:q:e2e", title: "How do I configure FixtureFlow timers?", hoursAgo: 50 },
];

test.beforeEach(async ({ page }) => {
  user = await createUser();
  const ids = await createWorkspaceWithProduct(user);
  productId = ids.productId;
  await seedMentions(ids.productId, ids.workspaceId, FIXTURES);
  await page.goto(await signInPath(user.email, "/mentions"));
  await expect(page).toHaveURL(/\/mentions$/);
});

test.afterEach(async () => {
  if (user) await deleteUser(user.id);
  user = null;
});

const items = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Mentions" }).getByRole("listitem");

test("lists stored mentions with working source links, newest first, paginated server-side", async ({ page }) => {
  await expect(page.getByText("30 mentions in this view")).toBeVisible();
  await expect(items(page)).toHaveCount(25);

  const first = items(page).first().getByRole("link");
  await expect(first).toHaveText(/FixtureFlow crashes on export/);
  await expect(first).toHaveAttribute("href", "https://github.com/e2e/fixtureflow/issues/1");
  await expect(first).toHaveAttribute("target", "_blank");
  await expect(first).toHaveAttribute("rel", /noopener/);

  await page.getByRole("link", { name: "Older" }).click();
  await expect(items(page)).toHaveCount(5);
  await expect(page.getByRole("link", { name: "Older" })).toHaveCount(0);
  await expect(items(page).last()).toContainText("How do I configure FixtureFlow timers?");
  await page.getByRole("link", { name: "Back to newest" }).click();
  await expect(items(page)).toHaveCount(25);
});

test("filters by source and searches text", async ({ page }) => {
  await page.getByLabel("Source").selectOption("github");
  await expect(page).toHaveURL(/source=github/);
  await expect(page.getByText("2 mentions in this view")).toBeVisible();
  await expect(items(page)).toHaveCount(2);

  await page.getByLabel("Search text").fill("dark mode");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(items(page)).toHaveCount(1);
  await expect(items(page).first()).toContainText("FixtureFlow dark mode request");

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText("30 mentions in this view")).toBeVisible();
});

test("marking a mention not relevant hides it, is stored as the user's decision, and can be undone", async ({ page }) => {
  const row = items(page).filter({ hasText: "FixtureFlow crashes on export" });
  await row.getByRole("button", { name: "Not relevant" }).click();
  await expect(page.getByText("29 mentions in this view")).toBeVisible();
  await expect.poll(() => readMention(productId, "e2e-gh-1").then((m) => m?.relevance_status)).toBe("user_irrelevant");

  await page.getByLabel("Relevance").selectOption("irrelevant");
  const hidden = items(page).filter({ hasText: "FixtureFlow crashes on export" });
  await expect(hidden.getByRole("button", { name: "Not relevant" })).toHaveAttribute("aria-pressed", "true");
  await hidden.getByRole("button", { name: "Not relevant" }).click();
  await expect.poll(() => readMention(productId, "e2e-gh-1").then((m) => m?.relevance_status)).toBe("relevant");
});

test("discloses which sources are included", async ({ page }) => {
  const notice = page.locator("p", { hasText: "Sources included:" });
  await expect(notice).toContainText("Hacker News");
  await expect(notice).toContainText("GitHub");
  // No YouTube key on this server: it must be listed as not included, not silently counted as zero.
  if (!process.env.YOUTUBE_API_KEY) await expect(notice).toContainText("YouTube (not configured)");
});
