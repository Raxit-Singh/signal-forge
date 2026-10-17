import { expect, test } from "@playwright/test";
import { adminInsert, adminSelect, createUser, createWorkspaceWithProduct, deleteUser, signInPath, type TestUser } from "./support";

// Connected sources UI. Nothing here calls Google or Discord: keys that fail the
// local checks never leave the server, and Discord isn't configured in development.

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

test("Google Play: bad keys are refused locally and never stored; Discord shows its setup state", async ({ page }) => {
  await page.goto(await signInPath(user!.email, "/integrations"));
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

  // Without the server's Discord app, setup isn't offered.
  await expect(card).toContainText("Discord isn't configured on this server yet");
  await page.goto("/api/discord/install?product=" + ids.productId);
  await expect(page.locator("#main").getByRole("alert").first()).toContainText("Discord isn't configured on this server yet");
});

test("a connected Discord server shows its channels; searches only start once channels are chosen", async ({ page }) => {
  // Simulates the state after Discord's bot authorization (the OAuth exchange itself needs a real Discord app).
  await adminInsert("integrations", {
    workspace_id: ids.workspaceId, product_id: ids.productId, provider: "discord", status: "connected", external_account: "FixtureFlow HQ",
    config: { guild_id: "123456789012345678", guild_name: "FixtureFlow HQ", channels: [], available_channels: [{ id: "223456789012345678", name: "feedback" }, { id: "323456789012345678", name: "general" }], mode: "all" },
  });
  await page.goto(await signInPath(user!.email, "/integrations"));
  const card = page.locator("#main").getByTestId("connected-sources");
  await expect(card).toContainText("Server: FixtureFlow HQ");
  await expect(card).toContainText("Choose channels");
  await expect(card.getByTestId("discord-channels").getByLabel("#feedback")).toBeVisible();
  await expect(card).toContainText("every message counts toward your mention allowance");
  const searches = await adminSelect<unknown[]>(`monitoring_queries?product_id=eq.${ids.productId}&provider=eq.discord&enabled=eq.true&select=id`);
  expect(searches, "no channels chosen: nothing is read").toHaveLength(0);
});
