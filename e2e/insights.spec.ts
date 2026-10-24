import { expect, test } from "@playwright/test";
import {
  adminSelect, adminUpdate, createUser, createWorkspaceWithProduct, deleteUser, seedMentions, signInPath, type FixtureMention, type TestUser,
} from "./support";

// Product Insights with the development-only test classifier (no model calls) and
// the development-only GitHub search stand-in (reserved e2e-fixture/* repositories).

let user: TestUser | null = null;
let ids = { workspaceId: "", productId: "" };

const FIXTURES: FixtureMention[] = [
  { source: "hackernews", externalId: "in-bug-1", title: "The app freezes when I login", content: "The app freezes when I login", hoursAgo: 30, author: "ann" },
  { source: "reddit", externalId: "in-bug-2", title: "Opening the login screen makes the app hang", content: "Opening the login screen makes the app hang", hoursAgo: 29, author: "bo" },
  { source: "github", externalId: "in-bug-3", title: "Signing in gets stuck forever", content: "Signing in gets stuck forever", hoursAgo: 28, author: "cy" },
  { source: "hackernews", externalId: "in-feat-1", title: "Please add dark mode", content: "Please add dark mode", hoursAgo: 27, author: "dee" },
  { source: "reddit", externalId: "in-feat-2", title: "Please add a dark mode", content: "Please add a dark mode", hoursAgo: 26, author: "eli" },
  { source: "github", externalId: "in-feat-3", title: "Please add dark mode support", content: "Please add dark mode support", hoursAgo: 25, author: "fay" },
];

test.beforeEach(async () => {
  user = await createUser();
  ids = await createWorkspaceWithProduct(user);
  await seedMentions(ids.productId, ids.workspaceId, FIXTURES, 30);
});

test.afterEach(async () => {
  if (user) await deleteUser(user.id);
  user = null;
});

test("issues → summary, GitHub draft (filed by the user on GitHub), existing issues, feature evaluation with measured demand", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto(await signInPath(user!.email, "/settings/ai"));
  await page.getByRole("button", { name: "Use test classifier" }).click();
  await expect(page.getByTestId("ai-status")).toContainText("Test classifier (not AI)");
  await page.goto("/feedback");
  await page.getByRole("button", { name: "Classify now" }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.locator("#main").getByTestId("feedback-issue")).toHaveCount(2, { timeout: 2000 });
  }).toPass({ timeout: 45_000 });

  await page.goto("/insights");
  const main = page.locator("#main");
  const list = main.getByTestId("insight-issues");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await list.getByRole("link", { name: /^Bug reports/ }).click();
  await expect(main.getByRole("heading", { level: 1 })).toContainText("Bug reports");
  expect(await main.getByRole("list", { name: "Supporting posts" }).getByRole("listitem").count()).toBeGreaterThanOrEqual(2);
  await expect(main.getByTestId("priority-evidence")).toContainText("Observed in collected posts");

  // No repository yet: the GitHub check isn't offered.
  await expect(main.getByTestId("github-duplicates")).toContainText("Add the product's GitHub repository");
  await expect(main.getByRole("button", { name: "Check GitHub" })).toHaveCount(0);

  await main.getByRole("button", { name: "Summarize" }).click();
  await expect(async () => {
    await page.reload();
    await expect(main.getByTestId("investigation-result").first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });
  const posted = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/insights/"));
  await main.getByRole("button", { name: "Draft GitHub issue" }).click();
  await posted;
  await expect(async () => {
    await page.reload();
    await expect(main.getByTestId("issue-draft")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });
  const draft = main.getByTestId("issue-draft");
  await expect(draft.getByLabel("Title")).toHaveValue(/Test classifier draft/);
  const body = await draft.getByLabel("Description (Markdown)").inputValue();
  expect(body).toContain("### What users report");
  expect(body).toMatch(/### Sources\n1\. \[.+\]\(https:\/\/example\.com\/e2e\//);
  expect(body).toMatch(/\d+ independent reporters on /);
  await expect(draft).toContainText("Add the product's GitHub repository");

  // With a repository: GitHub's own new-issue page, prefilled (the user files it), and the existing-issue check.
  await adminUpdate(`products?id=eq.${ids.productId}`, { github_repo: "e2e-fixture/app" });
  await page.reload();
  await draft.getByLabel("Title").fill("Login freezes the app");
  const href = await draft.getByRole("link", { name: /Open on GitHub/ }).getAttribute("href");
  const u = new URL(href!);
  expect(u.origin + u.pathname).toBe("https://github.com/e2e-fixture/app/issues/new");
  expect(u.searchParams.get("title")).toBe("Login freezes the app");
  expect(u.searchParams.get("body")).toContain("### Sources");

  const dup = main.getByTestId("github-duplicates");
  await dup.getByRole("button", { name: "Check GitHub" }).click();
  await expect(dup.getByRole("list", { name: "Existing GitHub issues" })).toBeVisible();
  const matches = dup.getByRole("listitem");
  // Ranked by shared words; "likely the same" vs "possibly related" thresholds are unit-tested.
  await expect(matches.first()).toContainText(/Likely the same|Possibly related/);
  await expect(matches.first()).toContainText("#41 App freezes on the login screen");
  await expect(dup).toContainText("searched for");
  await expect(dup).not.toContainText("#50", { timeout: 1000 }); // pull requests are left out
  await expect(dup).not.toContainText("dark mode");

  // A private (or missing) repository: said plainly, nothing else changes.
  await adminUpdate(`products?id=eq.${ids.productId}`, { github_repo: "e2e-fixture/private" });
  await page.reload();
  await dup.getByRole("button", { name: "Check again" }).click();
  await expect(dup).toContainText("doesn't exist or is private");

  // Feature request: measured demand next to the cited evaluation.
  await page.goto("/insights");
  await list.getByRole("link", { name: /^Feature requests/ }).click();
  const feat = main.getByTestId("feature-evaluation");
  await expect(feat.getByTestId("demand")).toContainText("early");
  await expect(feat.getByTestId("demand")).toContainText("Only 3 different people asked so far");
  await feat.getByRole("button", { name: "Evaluate request" }).click();
  await expect(async () => {
    await page.reload();
    await expect(feat.getByTestId("investigation-result")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });
  await expect(feat.getByTestId("investigation-result")).toContainText("Test classifier — not AI analysis");
  await expect(feat.getByTestId("investigation-result")).toContainText("Need");
  await expect(feat.getByTestId("open-questions")).toBeVisible();

  await page.goto("/insights");
  await expect(main.getByRole("list", { name: "Recent analyses" })).toContainText("Feature evaluation");
  await expect(list).toContainText("GitHub draft"); // the analyses done for an issue show as check pills

  const usage = await adminSelect<Array<{ purpose: string; billed_to: string }>>(`ai_usage_records?workspace_id=eq.${ids.workspaceId}&select=purpose,billed_to`);
  expect(new Set(usage.map((x) => x.purpose))).toEqual(new Set(["classify", "embed", "cluster_summary", "issue_draft", "feature_evaluation"]));
  expect(usage.every((x) => x.billed_to === "test")).toBe(true);
});
