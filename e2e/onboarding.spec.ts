import { expect, test } from "@playwright/test";
import { createUnconfirmedUser, deleteUser } from "./support";

// Times are shown in the viewer's own zone; pin one so the assertions are stable.
test.use({ timezoneId: "Asia/Kolkata" });
const local = (d: Date) => new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: "Asia/Kolkata",
}).format(d);

let userId: string | null = null;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = null;
});

test("registration → verification → workspace → product → keywords → sources → historical search", async ({ page }) => {
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
  // Free plan: one active keyword; further suggestions start switched off with the reason.
  await expect(page.getByRole("checkbox", { name: "Listen for fixtureflow.example" })).not.toBeChecked();
  await expect(page.getByText(/plan allows 1/)).toBeVisible();
  await page.getByPlaceholder("Add a keyword, handle or misspelling").fill("timer");
  await page.getByRole("button", { name: "Add" }).click();
  const timer = page.getByRole("checkbox", { name: "Listen for timer" });
  await expect(timer).not.toBeChecked();
  await expect(timer).toBeDisabled();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/sources$/);

  // Just the platforms: icon and name, nothing to configure.
  await expect(page.getByRole("list", { name: "Platforms" }).getByText("Hacker News")).toBeVisible();
  await expect(page.getByText("Public sources need nothing from you")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/scan$/);

  // Historical search: the user chooses how far back; nothing runs or is estimated before they start it.
  await expect(page.getByText("How far back should SignalForge search for mentions?")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Last 30 days" })).toBeChecked();
  await expect(page.getByTestId("history-range")).toContainText(/Searches from \w{3} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M GMT\+5:30 to \w{3} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M GMT\+5:30 \(30 days\)/);
  // Free plan: 30 days of history; longer presets are offered but disabled with the reason.
  await expect(page.getByRole("radio", { name: "Last 90 days" })).toBeDisabled();
  await expect(page.getByText("Beyond your plan").first()).toBeVisible();
  // Since launch needs the real launch date (never assumed).
  await page.getByRole("radio", { name: "Since product launch" }).check();
  await expect(page.getByRole("button", { name: "Start historical search" })).toBeDisabled();
  await expect(page.getByTestId("history-range")).toContainText("Enter your product's launch date");
  const recent = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Product launch date").fill(recent);
  await expect(page.getByTestId("history-range")).toContainText(`Searches from ${local(new Date(`${recent}T00:00:00Z`))}`);
  await expect(page.getByRole("button", { name: "Start historical search" })).toBeEnabled();
  // Custom dates outside the plan's window are refused with the limit stated.
  await page.getByRole("radio", { name: "Custom date" }).check();
  await page.getByLabel("Search from").fill(new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10));
  await expect(page.getByTestId("history-range")).toContainText("Your Free plan searches back up to 30 days");
  await expect(page.getByRole("button", { name: "Start historical search" })).toBeDisabled();

  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("heading", { name: "FixtureFlow" })).toBeVisible();
  await expect(page.getByText("No mention data yet")).toBeVisible();
  await expect(page.locator("p", { hasText: "Sources included:" })).toContainText("none yet");
});
