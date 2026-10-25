import { expect, test } from "@playwright/test";
import {
  createUser, createWorkspaceWithProduct, deleteUser, readMention, seedMentions, signInPath, type FixtureMention, type TestUser,
} from "./support";

let user: TestUser | null = null;
let productId = "";

const LONG = `FixtureFlow review. ${"It keeps my focus sessions organised and the timer never drifts. ".repeat(12)}Ende: Überraschend gut.`;

// 40 HN fixtures + 2 GitHub + 1 Stack Exchange + 2 Reddit comments = 45 mentions, newest first by hoursAgo.
const FIXTURES: FixtureMention[] = [
  ...Array.from({ length: 40 }, (_, i) => ({
    source: "hackernews" as const, externalId: `e2e-hn-${i}`, title: `FixtureFlow HN post ${i}`, hoursAgo: i + 1,
  })),
  { source: "github", externalId: "e2e-gh-1", title: "FixtureFlow crashes on export", content: "Steps to reproduce: open FixtureFlow", hoursAgo: 0.5, url: "https://github.com/e2e/fixtureflow/issues/1" },
  { source: "github", externalId: "e2e-gh-2", title: "FixtureFlow dark mode request", content: LONG, hoursAgo: 40.5 },
  { source: "stackexchange", externalId: "stackoverflow:q:e2e", title: "How do I configure FixtureFlow timers?", hoursAgo: 50 },
  { source: "reddit", externalId: "e2e-rd-c1", title: "u/a on r/productivity", content: "FixtureFlow is my go-to timer", hoursAgo: 3.5, type: "comment" },
  { source: "reddit", externalId: "e2e-rd-c2", title: "u/b on r/productivity", content: "Tried FixtureFlow last week", hoursAgo: 60, type: "comment" },
];
const TOTAL = FIXTURES.length;

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
const pager = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Pagination" });
/** Picks an option in one of the themed filter dropdowns (a pill that opens a menu). */
const pick = async (page: import("@playwright/test").Page, label: string, option: string) => {
  await page.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).click();
};
const titles = (page: import("@playwright/test").Page) => items(page).locator("h3").allInnerTexts();

test("numbered pagination: ranges, current page, boundaries, stable order, back/forward", async ({ page }) => {
  await expect(page.getByText(`Showing 1–20 of ${TOTAL} mentions`)).toBeVisible();
  await expect(items(page)).toHaveCount(20);
  await expect(pager(page).getByRole("link", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
  await expect(pager(page).getByRole("button", { name: "Previous" })).toBeDisabled();
  await expect(pager(page).getByRole("link", { name: "Page 3" })).toBeVisible();

  const first = items(page).first();
  await expect(first.locator("h3")).toHaveText("FixtureFlow crashes on export");
  const link = first.getByRole("link", { name: /Open original on GitHub/ });
  await expect(link).toHaveAttribute("href", "https://github.com/e2e/fixtureflow/issues/1");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);

  const seen = [...(await titles(page))];
  await pager(page).getByRole("link", { name: "Page 2" }).click();
  await expect(page).toHaveURL(/[?&]page=2/);
  await expect(page.getByText(`Showing 21–40 of ${TOTAL} mentions`)).toBeVisible();
  await expect(pager(page).getByRole("link", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  seen.push(...(await titles(page)));

  await pager(page).getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/[?&]page=3/);
  await expect(page.getByText(`Showing 41–${TOTAL} of ${TOTAL} mentions`)).toBeVisible();
  await expect(items(page)).toHaveCount(TOTAL - 40);
  await expect(pager(page).getByRole("button", { name: "Next" })).toBeDisabled();
  seen.push(...(await titles(page)));
  // Every mention exactly once across pages, newest first.
  expect(seen).toHaveLength(TOTAL);
  expect(new Set(seen).size).toBe(TOTAL);
  await expect(items(page).last().locator("h3")).toHaveText("u/b on r/productivity");

  await page.goBack();
  await expect(page).toHaveURL(/[?&]page=2/);
  await expect(page.getByText(`Showing 21–40 of ${TOTAL} mentions`)).toBeVisible();
  await page.goForward();
  await expect(page.getByText(`Showing 41–${TOTAL} of ${TOTAL} mentions`)).toBeVisible();

  // Past the last page: redirected to the last page, not an empty list.
  await page.goto("/mentions?page=99");
  await expect(page).toHaveURL(/[?&]page=3/);
  await expect(items(page)).toHaveCount(TOTAL - 40);
});

test("filters persist across pages, reset to page 1 when changed, and work with every filter", async ({ page }) => {
  await pick(page, "Platform", "Hacker News");
  await expect(page).toHaveURL(/source=hackernews/);
  await expect(page.getByText("Showing 1–20 of 40 mentions")).toBeVisible();
  await pager(page).getByRole("link", { name: "Page 2" }).click();
  await expect(page).toHaveURL(/source=hackernews.*page=2|page=2.*source=hackernews/);
  await expect(page.getByText("Showing 21–40 of 40 mentions")).toBeVisible();
  for (const name of await items(page).locator("h3").allInnerTexts()) expect(name).toMatch(/HN post/);
  await expect(page.getByRole("button", { name: /^Platform:/ })).toHaveAccessibleName("Platform: Hacker News");

  // Changing a filter goes back to page 1 and keeps the others.
  await page.getByLabel("Search text").fill("post 3");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).not.toHaveURL(/page=/);
  await expect(page).toHaveURL(/source=hackernews/);
  await expect(page.getByText(/Showing 1–\d+ of \d+ mentions?/)).toBeVisible();
  for (const name of await items(page).locator("h3").allInnerTexts()) expect(name).toMatch(/HN post 3/);

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText(`Showing 1–20 of ${TOTAL} mentions`)).toBeVisible();

  await pick(page, "Type", "Comment");
  await expect(page).toHaveURL(/type=comment/);
  await expect(page.getByText("Showing 1–2 of 2 mentions")).toBeVisible();
  await expect(items(page).first()).toContainText("Comment");
  await expect(items(page).first().getByRole("link", { name: /Open original on Reddit/ })).toBeVisible();
  await expect(pager(page)).toHaveCount(0);
});

test("long content is clamped with Read more / Show less; stored text stays intact", async ({ page }) => {
  await page.goto("/mentions?source=github");
  const row = items(page).filter({ hasText: "FixtureFlow dark mode request" });
  const more = row.getByRole("button", { name: "Read more" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  const para = row.locator("p[dir=auto]");
  const clamped = await para.evaluate((el) => el.clientHeight);
  await more.click();
  await expect(row.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
  expect(await para.evaluate((el) => el.clientHeight)).toBeGreaterThan(clamped);
  await expect(para).toContainText("Ende: Überraschend gut.");
  // Short content gets no toggle.
  await expect(items(page).filter({ hasText: "FixtureFlow crashes on export" }).getByRole("button", { name: "Read more" })).toHaveCount(0);
});

test("relevance feedback: selected state is visible, stored as the user's decision, and can be undone", async ({ page }) => {
  const row = items(page).filter({ hasText: "FixtureFlow crashes on export" });
  await expect(row).toContainText("Keyword match");
  await row.getByRole("button", { name: "Relevant", exact: true }).click();
  await expect(row.getByRole("button", { name: "Relevant", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => readMention(productId, "e2e-gh-1").then((m) => m?.relevance_status)).toBe("user_relevant");

  await row.getByRole("button", { name: "Not relevant" }).click();
  await expect(page.getByText(`Showing 1–20 of ${TOTAL - 1} mentions`)).toBeVisible();
  await expect.poll(() => readMention(productId, "e2e-gh-1").then((m) => m?.relevance_status)).toBe("user_irrelevant");

  await pick(page, "Relevance", "Not relevant");
  const hidden = items(page).filter({ hasText: "FixtureFlow crashes on export" });
  await expect(hidden).toContainText("Not relevant");
  await expect(hidden.getByRole("button", { name: "Not relevant" })).toHaveAttribute("aria-pressed", "true");
  await hidden.getByRole("button", { name: "Not relevant" }).click();
  await expect.poll(() => readMention(productId, "e2e-gh-1").then((m) => m?.relevance_status)).toBe("relevant");
});

test("mobile: stacked cards, compact pagination, touch-sized controls, no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(pager(page).getByText("Page 1 of 3")).toBeVisible();
  await expect(pager(page).getByRole("link", { name: "Page 2" })).toBeHidden();
  const button = items(page).first().getByRole("button", { name: "Not relevant" });
  const box = await button.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(36);
  await pager(page).getByRole("link", { name: "Next" }).click();
  await expect(pager(page).getByText("Page 2 of 3")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
