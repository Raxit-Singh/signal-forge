import { expect, test } from "@playwright/test";
import {
  adminInsert, adminSelect, adminUpdate, createUser, createWorkspaceWithProduct, deleteUser, seedMentions, signInPath, type TestUser,
} from "./support";

// Competitor tracking: add through the UI (plan limit, keyword cap), the tracking
// product gets real searches, comparisons use only sources monitored for both,
// over the period both were tracked; pause and remove.

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

test("free plan can't add competitors", async ({ page }) => {
  await page.goto(await signInPath(user!.email, "/competitors"));
  const main = page.locator("#main");
  await expect(main.getByText("doesn't include competitor tracking")).toBeVisible();
  await expect(main.getByRole("button", { name: "Add competitor" })).toBeDisabled();
});

test("add → searches created → share of voice, volume and sentiment on common sources → pause → remove", async ({ page }) => {
  await adminInsert("internal_plan_grants", {
    workspace_id: ids.workspaceId, plan_id: "pro", reason: "development", granted_by: "e2e-competitors", expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  await page.goto(await signInPath(user!.email, "/competitors"));
  const main = page.locator("#main");
  await expect(main.getByText("0 of 3 used")).toBeVisible();

  // Keyword cap: the name plus at most 2.
  const form = main.getByTestId("add-competitor");
  await form.getByLabel("Competitor name").fill("Zorblax Metrics");
  await form.getByLabel(/Extra keywords/).fill("zorblax.io, Zorblax app, zorblax hq");
  await form.getByRole("button", { name: "Add competitor" }).click();
  await expect(form.getByText("Up to 2 extra keywords")).toBeVisible();
  await form.getByLabel(/Extra keywords/).fill("zorblax.io, Zorblax app");
  await form.getByRole("button", { name: "Add competitor" }).click();
  await expect(form.getByText("Tracking Zorblax Metrics")).toBeVisible();

  const comp = main.getByTestId("competitor");
  await expect(comp).toHaveCount(1);
  await expect(comp).toContainText("Tracking");
  await expect(comp).toContainText("“Zorblax Metrics”, “zorblax.io”, “Zorblax app”");

  const [c] = await adminSelect<Array<{ id: string; tracking_product_id: string }>>(`competitors?product_id=eq.${ids.productId}&select=id,tracking_product_id`);
  const trackingId = c!.tracking_product_id;
  const queries = await adminSelect<Array<{ provider: string; enabled: boolean }>>(`monitoring_queries?product_id=eq.${trackingId}&enabled=eq.true&select=provider,enabled`);
  expect(queries.length, "the competitor is searched on the free sources").toBeGreaterThan(0);
  const products = await adminSelect<Array<{ id: string }>>(`products?workspace_id=eq.${ids.workspaceId}&competitor_of=is.null&select=id`);
  expect(products.length, "the tracking product is not one of the workspace's products").toBe(1);

  // Both tracked for the last 10 days; fixture mentions on Hacker News and GitHub.
  const since = new Date(Date.now() - 10 * 86_400_000).toISOString();
  await adminUpdate(`competitors?id=eq.${c!.id}`, { created_at: since });
  await adminUpdate(`products?id=eq.${ids.productId}`, { created_at: since });
  await seedMentions(ids.productId, ids.workspaceId, [
    { source: "hackernews", externalId: "cp-p1", title: "FixtureFlow is fast", hoursAgo: 30 },
    { source: "hackernews", externalId: "cp-p2", title: "Trying FixtureFlow", hoursAgo: 50 },
    { source: "github", externalId: "cp-p3", title: "FixtureFlow issue", hoursAgo: 70 },
    { source: "bluesky", externalId: "cp-p4", title: "FixtureFlow on Bluesky", hoursAgo: 20 },
  ], 10);
  await seedMentions(trackingId, ids.workspaceId, [
    { source: "hackernews", externalId: "cp-c1", title: "Zorblax Metrics launch", hoursAgo: 40 },
  ], 10);
  // Too old for the comparison: before the competitor was tracked.
  await seedMentions(trackingId, ids.workspaceId, [{ source: "github", externalId: "cp-c-old", title: "Zorblax old", hoursAgo: 24 * 20 }], 30);

  await page.goto("/competitors?range=30d");
  const voice = main.getByTestId("share-of-voice");
  // Product: 3 on common sources. The fixture product isn't searched on Bluesky, so its Bluesky post is left out.
  const productCount = 3;
  await expect(voice.getByRole("listitem").filter({ hasText: "FixtureFlow" })).toContainText(`${productCount} mentions`);
  await expect(voice.getByRole("listitem").filter({ hasText: "Zorblax Metrics" })).toContainText("1 mention");
  await expect(voice.getByRole("listitem").filter({ hasText: "Zorblax Metrics" })).toContainText(`${Math.round(100 / (productCount + 1))}%`);
  await expect(main.getByText("The period starts when the most recently added competitor began to be tracked", { exact: false })).toBeVisible();
  await expect(main.getByTestId("excluded-sources")).toContainText("Bluesky (not monitored for FixtureFlow)");
  await expect(main.getByRole("img", { name: /Relevant mentions per day/ })).toBeVisible();
  await expect(main.getByTestId("competitor-sentiment")).toContainText("Not classified yet.");

  // Pause: the tracking product is archived and its searches stop.
  await comp.getByRole("button", { name: "Pause" }).click();
  await expect(comp).toContainText("Paused");
  const [tp] = await adminSelect<Array<{ archived_at: string | null }>>(`products?id=eq.${trackingId}&select=archived_at`);
  expect(tp!.archived_at).not.toBeNull();
  await expect.poll(async () => (await adminSelect<unknown[]>(`monitoring_queries?product_id=eq.${trackingId}&enabled=eq.true&select=id`)).length).toBe(0);
  await expect(main.getByText("No comparison yet")).toBeVisible();

  // Remove: competitor, tracking product and its mentions are gone.
  page.once("dialog", (d) => d.accept());
  await comp.getByRole("button", { name: "Remove" }).click();
  await expect(main.getByTestId("competitor")).toHaveCount(0);
  expect(await adminSelect<unknown[]>(`products?id=eq.${trackingId}&select=id`)).toHaveLength(0);
  expect(await adminSelect<unknown[]>(`mentions?product_id=eq.${trackingId}&select=id`)).toHaveLength(0);
});
