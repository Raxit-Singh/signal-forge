import { expect, test } from "@playwright/test";
import { adminSelect, createUser, createWorkspaceWithProduct, deleteUser, signInPath, type TestUser } from "./support";

// Email without a provider: development has no RESEND_API_KEY, so every email is
// recorded as "skipped" instead of sent — the flows still run end to end.

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

test("invitation emails are attempted (skipped without a provider); weekly email toggle; unsubscribe links are verified", async ({ page, request }) => {
  await page.goto(await signInPath(user!.email, "/settings/workspace"));
  const form = page.locator("#main").getByTestId("invite-form");
  await form.getByLabel("Email address").fill("someone-new@example.com");
  await form.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.locator("#main").getByTestId("invite-link")).toContainText("Copy the link and send it to them");
  const log = await adminSelect<Array<{ kind: string; status: string; recipient: string; subject: string }>>(`email_log?workspace_id=eq.${ids.workspaceId}&select=kind,status,recipient,subject`);
  expect(log).toEqual([{ kind: "invitation", status: "skipped", recipient: "someone-new@example.com", subject: "Join E2E Workspace on SignalForge" }]);

  await page.goto("/settings/account");
  const card = page.locator("#main").getByTestId("email-settings");
  await expect(card).toContainText("Weekly report emails: on");
  await expect(card).toContainText("Email isn't set up on this server yet");
  await card.getByRole("button", { name: "Turn off" }).click();
  await expect(card).toContainText("Weekly report emails: off");
  const [pref] = await adminSelect<Array<{ weekly_report: boolean }>>(`notification_preferences?workspace_id=eq.${ids.workspaceId}&select=weekly_report`);
  expect(pref!.weekly_report).toBe(false);

  // Forged or damaged unsubscribe links do nothing.
  const bad = await request.post("/api/email/unsubscribe?t=eyJ1Ijoi.x");
  expect(bad.status()).toBe(400);
  const shown = await request.get("/api/email/unsubscribe?t=nope");
  expect(shown.status()).toBe(400);
  expect(await shown.text()).toContain("This unsubscribe link isn't valid");
});
