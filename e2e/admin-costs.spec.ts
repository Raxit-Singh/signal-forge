import { expect, test } from "@playwright/test";
import { adminSelect, createUser, createWorkspaceWithProduct, deleteUser, signInPath, type TestUser } from "./support";

// The staff cost dashboard: only verified accounts listed in SIGNALFORGE_STAFF_EMAILS
// (the development .env.local lists sf-e2e-staff@example.com); everyone else gets a 404.

const STAFF = "sf-e2e-staff@example.com";
let users: TestUser[] = [];

test.afterEach(async () => {
  for (const u of users) await deleteUser(u.id);
  users = [];
});

test("customers get a 404; staff see spend against the limits", async ({ page, browser }) => {
  const customer = await createUser();
  users.push(customer);
  await createWorkspaceWithProduct(customer);
  await page.goto(await signInPath(customer.email, "/admin/costs"));
  await expect(page.getByText("Costs (staff)")).toHaveCount(0);
  expect(await page.title()).not.toContain("Costs");
  await expect(page.locator("body")).toContainText(/not found|404|doesn.t exist/i);

  // Leftover fixture account from an interrupted run.
  const stale = await adminSelect<Array<{ id: string }>>(`profiles?email=eq.${STAFF}&select=id`);
  for (const s of stale) await deleteUser(s.id);
  const staff = await createUser(STAFF);
  users.push(staff);
  await createWorkspaceWithProduct(staff, "StaffProduct");
  const ctx = await browser.newContext();
  const sp = await ctx.newPage();
  await sp.goto(await signInPath(STAFF, "/admin/costs"));
  const main = sp.locator("#main");
  await expect(main.getByRole("heading", { name: "Costs" })).toBeVisible();
  await expect(main.getByText("SignalForge Intelligence (Gemini)")).toBeVisible();
  await expect(main.getByText("Paid data (API Direct)")).toBeVisible();
  await expect(main.getByTestId("spend-meter")).toHaveCount(2);
  await expect(main.getByRole("heading", { name: "Workspaces" })).toBeVisible();
  await ctx.close();
});
