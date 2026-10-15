import { expect, test } from "@playwright/test";
import { createUnconfirmedUser, deleteUser } from "./support";

let userId: string | null = null;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = null;
});

test("registration → verification → workspace → product → keywords → sources → AI → first scan", async ({ page }) => {
  const user = await createUnconfirmedUser();
  userId = user.id;

  // Email verification link lands on onboarding.
  await page.goto(user.confirmPath);
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.getByLabel("Workspace name").fill("E2E Labs");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/product$/);

  // Invalid (private) URL is rejected and the other fields keep their values.
  await page.getByLabel("Product name").fill("FixtureFlow");
  await page.getByLabel(/Website/).fill("http://localhost:8080");
  await page.getByLabel(/What does it do/).fill("Pomodoro timer for developers");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Use a public domain name.")).toBeVisible();
  await expect(page.getByLabel("Product name")).toHaveValue("FixtureFlow");
  await expect(page.getByLabel(/What does it do/)).toHaveValue("Pomodoro timer for developers");

  await page.getByLabel(/Website/).fill("fixtureflow.example");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/keywords$/);

  // Suggested keywords are editable; an ambiguous one can't be enabled without context.
  await expect(page.getByRole("checkbox", { name: "Listen for FixtureFlow", exact: true })).toBeChecked();
  await page.getByPlaceholder("Add a keyword, handle or misspelling").fill("timer");
  await page.getByRole("button", { name: "Add" }).click();
  const timer = page.getByRole("checkbox", { name: "Listen for timer" });
  await expect(timer).not.toBeChecked();
  await expect(timer).toBeDisabled();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/sources$/);

  await expect(page.getByText("Hacker News").first()).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/ai$/);

  await page.getByRole("button", { name: "Use SignalForge credits" }).click();
  await expect(page).toHaveURL(/\/scan$/);

  // The scan step names the sources it will search; nothing is run or estimated before the user starts it.
  await expect(page.getByRole("button", { name: "Start scan" })).toBeVisible();
  await expect(page.getByText(/Results are what the sources actually return/)).toBeVisible();

  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("heading", { name: "FixtureFlow" })).toBeVisible();
  await expect(page.getByText("No mention data yet")).toBeVisible();
  await expect(page.locator("p", { hasText: "Sources included:" })).toContainText("none yet");
});
