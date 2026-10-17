import { expect, test } from "@playwright/test";
import { adminSelect, createUnconfirmedUser, createUser, createWorkspaceWithProduct, deleteUser, signInPath, type TestUser } from "./support";

// Invitations: a single-use link for one address and role. Joining requires being
// signed in with that address; owners/admins manage roles; anyone can leave.

let owner: TestUser | null = null;
let invitee: TestUser | null = null;
let other: TestUser | null = null;
let ids = { workspaceId: "", productId: "" };

test.beforeEach(async () => {
  owner = await createUser();
  invitee = await createUser();
  other = await createUser();
  ids = await createWorkspaceWithProduct(owner);
});

test.afterEach(async () => {
  for (const u of [owner, invitee, other]) if (u) await deleteUser(u.id);
  owner = invitee = other = null;
});

async function invite(page: import("@playwright/test").Page, email: string, role: "member" | "viewer" | "admin") {
  const form = page.locator("#main").getByTestId("invite-form");
  await form.getByLabel("Email address").fill(email);
  await form.getByLabel("Role").selectOption(role);
  await form.getByRole("button", { name: "Create invitation" }).click();
  const box = page.locator("#main").getByTestId("invite-link");
  await expect(box).toContainText(`Invitation for ${email.toLowerCase()} created`);
  return new URL((await box.locator("code").innerText()).trim()).pathname;
}

test("invite → accept with the right account → roles → remove; links are single use and bound to the address", async ({ page, browser }) => {
  await page.goto(await signInPath(owner!.email, "/settings/workspace"));
  const main = page.locator("#main");
  await expect(main.getByTestId("members").getByRole("listitem")).toHaveCount(1);
  const link = await invite(page, invitee!.email.toUpperCase(), "viewer");
  expect(link).toMatch(/^\/invite\/[A-Za-z0-9_-]{43}$/);
  await page.reload();
  await expect(main.getByTestId("pending-invitations")).toContainText(invitee!.email);
  const stored = await adminSelect<Array<{ token_hash: string }>>(`workspace_invitations?workspace_id=eq.${ids.workspaceId}&select=token_hash`);
  expect(stored[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(link).not.toContain(stored[0]!.token_hash);

  // The wrong account can see what it is but can't accept it.
  const otherCtx = await browser.newContext();
  const op = await otherCtx.newPage();
  await op.goto(await signInPath(other!.email, link));
  await expect(op.getByTestId("invitation")).toContainText(`but this invitation is for ${invitee!.email}`);
  await expect(op.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
  await otherCtx.close();

  // The invited account joins as a viewer and lands in the workspace.
  const ctx = await browser.newContext();
  const ip = await ctx.newPage();
  await ip.goto(await signInPath(invitee!.email, link));
  await expect(ip.getByTestId("invitation")).toContainText("Join E2E Workspace");
  await expect(ip.getByTestId("invitation")).toContainText("a viewer (read-only)");
  await ip.getByRole("button", { name: "Accept invitation" }).click();
  await ip.waitForURL(/\/overview/);
  const [m] = await adminSelect<Array<{ role: string }>>(`workspace_members?workspace_id=eq.${ids.workspaceId}&user_id=eq.${invitee!.id}&select=role`);
  expect(m!.role).toBe("viewer");
  await ip.goto(link);
  await expect(ip.getByTestId("invitation")).toContainText("already used");
  // A viewer sees members but no invitation tools.
  await ip.goto("/settings/workspace");
  await expect(ip.locator("#main").getByTestId("members").getByRole("listitem")).toHaveCount(2);
  await expect(ip.locator("#main").getByTestId("invite-form")).toHaveCount(0);

  // The owner promotes them, then removes them.
  await page.reload();
  const row = main.getByTestId("members").getByRole("listitem").filter({ hasText: invitee!.email });
  await row.getByLabel("Role").selectOption("member");
  await expect(async () => {
    const [r] = await adminSelect<Array<{ role: string }>>(`workspace_members?workspace_id=eq.${ids.workspaceId}&user_id=eq.${invitee!.id}&select=role`);
    expect(r!.role).toBe("member");
  }).toPass({ timeout: 10_000 });
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Remove" }).click();
  await expect(main.getByTestId("members").getByRole("listitem")).toHaveCount(1);
  await ctx.close();

  // Revoking a pending invitation kills its link.
  const second = await invite(page, other!.email, "member");
  await page.reload();
  await main.getByTestId("pending-invitations").getByRole("button", { name: "Revoke" }).click();
  await expect(main.getByTestId("pending-invitations")).toHaveCount(0);
  const c2 = await browser.newContext();
  const p2 = await c2.newPage();
  await p2.goto(await signInPath(other!.email, second));
  await expect(p2.getByTestId("invitation")).toContainText("withdrawn");
  await c2.close();
});

test("a new person signs up from the invitation link and lands back on it", async ({ page }) => {
  await page.goto(await signInPath(owner!.email, "/settings/workspace"));
  const fresh = await createUnconfirmedUser();
  const link = await invite(page, fresh.email, "member");
  await page.context().clearCookies();
  await page.goto(link);
  await expect(page).toHaveURL(/\/login\?next=%2Finvite%2F/);
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/signup\?next=%2Finvite%2F/);
  // Both the Google and the email sign-up forms carry the way back.
  for (const v of await page.locator('form input[name="next"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))) expect(v).toBe(link);
  // Confirming the account (the emailed link) returns to the invitation.
  await page.goto(fresh.confirmPath.replace("next=/onboarding", `next=${encodeURIComponent(link)}`));
  await expect(page.getByTestId("invitation")).toContainText("Join E2E Workspace");
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await page.waitForURL(/\/overview/);
  await deleteUser(fresh.id);
});
