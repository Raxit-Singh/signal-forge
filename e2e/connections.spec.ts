import { expect, test } from "@playwright/test";
import { adminSelect, createUser, createWorkspaceWithProduct, deleteUser, signInPath, type TestUser } from "./support";

// Connected sources (Settings → Connections). Nothing here calls Google: keys that
// fail the local checks never leave the server.

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

test("Google Play: bad keys are refused locally and never stored", async ({ page }) => {
  await page.goto(await signInPath(user!.email, "/settings/connections"));
  const card = page.locator("#main").getByTestId("connected-sources");
  await expect(card).toContainText("Google Play reviews");
  await expect(card).toContainText("Not connected");

  const form = card.getByTestId("google-play-connect");
  const key = form.getByLabel("Service account key (JSON)");
  await key.fill("{ this is not json at all, but it is long enough to pass the length check }");
  await form.getByRole("button", { name: "Connect Google Play" }).click();
  await expect(form).toContainText("isn't valid JSON");
  await expect(key).toHaveValue("", { timeout: 2000 }); // secrets are never echoed back into the page

  await key.fill(JSON.stringify({ type: "authorized_user", client_id: "x".repeat(40), client_secret: "y".repeat(20) }));
  await form.getByRole("button", { name: "Connect Google Play" }).click();
  await expect(form).toContainText("not a service account key");

  await key.fill(JSON.stringify({ type: "service_account", client_email: "reader@acme.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n", token_uri: "https://evil.example/token" }));
  await form.getByRole("button", { name: "Connect Google Play" }).click();
  await expect(form).toContainText("Unexpected token address");

  expect(await adminSelect<unknown[]>(`credential_secrets?workspace_id=eq.${ids.workspaceId}&select=id`)).toHaveLength(0);
  expect(await adminSelect<unknown[]>(`integrations?workspace_id=eq.${ids.workspaceId}&provider=eq.google_play&select=id`)).toHaveLength(0);

});
