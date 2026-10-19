import { expect, test } from "@playwright/test";
import { adminSelect, createUser, createWorkspaceWithProduct, deleteUser, signInPath, type TestUser } from "./support";

let user: TestUser | null = null;
test.afterEach(async () => {
  if (user) await deleteUser(user.id);
  user = null;
});

test("renaming a product makes every platform search for the new name", async ({ page }) => {
  user = await createUser();
  const ids = await createWorkspaceWithProduct(user);
  await page.goto(await signInPath(user.email, `/settings/products/${ids.productId}`));
  await page.getByLabel("Product name").fill("RenamedFlow");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Keywords now search for “RenamedFlow”.")).toBeVisible();

  const aliases = await adminSelect<Array<{ term: string; enabled: boolean }>>(`product_aliases?product_id=eq.${ids.productId}&select=term,enabled`);
  expect(aliases.map((a) => a.term)).toEqual(["RenamedFlow"]);
  const queries = await adminSelect<Array<{ query: string }>>(`monitoring_queries?product_id=eq.${ids.productId}&enabled=eq.true&select=query`);
  expect(queries.length).toBeGreaterThan(0);
  for (const q of queries) expect(q.query).not.toContain("FixtureFlow");

  // The keyword page and the historical search show the new name, not the old one.
  await page.goto(`/settings/products/${ids.productId}/keywords`);
  await expect(page.getByRole("checkbox", { name: "Listen for RenamedFlow", exact: true })).toBeChecked();
  await expect(page.getByText("FixtureFlow", { exact: true })).toHaveCount(0);
});
