import { expect, test } from "@playwright/test";
import { adminInsert, adminSelect, adminUpdate, createUser, createWorkspaceWithProduct, deleteUser, signInPath, type TestUser } from "./support";

// Plans, mention allowance and keyword allowance. No payment flow exists; nothing is charged.
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

async function setUsage(consumed: number, allowance: number) {
  const [sub] = await adminSelect<Array<{ current_period_start: string; current_period_end: string }>>(
    `subscriptions?workspace_id=eq.${ids.workspaceId}&select=current_period_start,current_period_end`,
  );
  await adminInsert("mention_usage_periods", {
    workspace_id: ids.workspaceId, period_start: sub!.current_period_start, period_end: sub!.current_period_end,
    plan_id: "free", mention_allowance: allowance, mentions_consumed: consumed, mentions_held: consumed >= allowance ? 3 : 0,
    exhausted_at: consumed >= allowance ? new Date().toISOString() : null,
  });
}

test("pricing: Free $0, Pro $100, Scale $300 with keyword and mention allowances; checkout only when Stripe is set up", async ({ page }) => {
  await page.goto(await signInPath(user!.email, "/settings/billing"));
  await expect(page.getByText("Current plan: Free")).toBeVisible();
  const free = page.getByLabel("Free plan");
  const pro = page.getByLabel("Pro plan");
  const scale = page.getByLabel("Scale plan");
  await expect(free).toContainText("$0/month");
  await expect(free).toContainText("1 keyword");
  await expect(free).toContainText("100 mentions / month");
  await expect(pro).toContainText("$100/month");
  await expect(pro).toContainText("10 keywords");
  await expect(pro).toContainText("15,000 mentions / month");
  await expect(scale).toContainText("$300/month");
  await expect(scale).toContainText("40 keywords");
  await expect(scale).toContainText("50,000 mentions / month");
  for (const old of ["$9", "$19", "$29", "$49", "Starter", "Business"]) await expect(page.getByText(old, { exact: true })).toHaveCount(0);
  await expect(free.getByRole("button", { name: "Current plan" })).toBeDisabled();
  if (process.env.STRIPE_SECRET_KEY) {
    // With Stripe (test mode) the owner can start checkout for a priced plan.
    await expect(pro.getByRole("button", { name: /Upgrade/ })).toBeEnabled();
  } else {
    await expect(pro.getByRole("button", { name: "Upgrade" })).toBeDisabled();
    await expect(page.getByText("Online payment isn't set up on this server yet")).toBeVisible();
  }

  // Current period usage.
  const mentions = page.getByRole("region", { name: "Mention allowance" });
  await expect(mentions).toContainText("0 of 100 used");
  await expect(mentions).toContainText("100 remaining");
  await expect(page.getByRole("region", { name: "Keyword allowance" })).toContainText("1 of 1");
  await expect(page.getByText(/Billing period .* – .*renews/)).toBeVisible();
});

test("usage warnings at 80 % and 90 %, and the 100 % hold state", async ({ page }) => {
  await setUsage(85, 100);
  await page.goto(await signInPath(user!.email, "/overview"));
  const banner = page.getByRole("status", { name: "Mention allowance" });
  await expect(banner).toContainText("85% of this period's 100 mentions used");

  await adminUpdate(`mention_usage_periods?workspace_id=eq.${ids.workspaceId}`, { mentions_consumed: 95 });
  await page.reload();
  await expect(page.getByRole("alert", { name: "Mention allowance" })).toContainText("95% of this period's 100 mentions used. When the allowance runs out, new mentions are held");

  await adminUpdate(`mention_usage_periods?workspace_id=eq.${ids.workspaceId}`, { mentions_consumed: 100, mentions_held: 3, exhausted_at: new Date().toISOString() });
  await page.goto("/settings/billing");
  await expect(page.getByRole("alert", { name: "Mention allowance" })).toContainText("mentions for this period are used up. New mentions are held");
  const mentions = page.getByRole("region", { name: "Mention allowance" });
  await expect(mentions).toContainText("100 of 100 used");
  await expect(mentions).toContainText("0 remaining");
  await expect(mentions).toContainText("No overage is charged and your plan is never upgraded automatically");
  await expect(mentions).toContainText("3 mentions are held from this period");
  await expect(mentions.getByRole("button", { name: /Deliver up to/ })).toHaveCount(0); // nothing left to deliver into

  // Upgrade (set by the server/payment provider, never by the user) raises the allowance at once.
  await adminUpdate(`subscriptions?workspace_id=eq.${ids.workspaceId}`, { plan_id: "pro" });
  await page.reload();
  await expect(page.getByText("Current plan: Pro")).toBeVisible();
  await expect(page.getByRole("region", { name: "Mention allowance" })).toContainText("100 of 15,000 used");
  await expect(page.getByRole("alert", { name: "Mention allowance" })).toHaveCount(0);
  await page.getByRole("button", { name: /Deliver up to 3 held mentions/ }).click();
  await expect(page.getByText(/Delivered 0 held mentions|No held mentions could be delivered/)).toBeVisible();
});

test("keyword allowance: Free allows one active keyword", async ({ page }) => {
  await page.goto(await signInPath(user!.email, `/settings/products/${ids.productId}/keywords`));
  await expect(page.getByText(/1 of 1 keywords active · plan allows 1/)).toBeVisible();
  await page.getByPlaceholder("Add a keyword, handle or misspelling").fill("fixtureflow.app");
  await page.getByRole("button", { name: "Add" }).click();
  const extra = page.getByRole("checkbox", { name: "Listen for fixtureflow.app" });
  await expect(extra).not.toBeChecked();
  await expect(extra).toBeDisabled();
  await expect(page.getByText("Off: your Free plan includes 1 active keyword.")).toBeVisible();
});
