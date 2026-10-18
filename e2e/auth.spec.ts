import { expect, test, type Page } from "@playwright/test";
import {
  authProviders, createPasswordUser, createUnconfirmedUser, createUser, createWorkspaceWithProduct, deleteUser,
  recoveryPath, usersWithEmail, workspaceCount,
} from "./support";

// Sign-in flows against the real Supabase project with throwaway accounts.
// No email is sent: links come from the admin API, exactly as the email would
// carry them. Third-party OAuth is only checked up to the hand-off to the
// provider; a real Google/GitHub/X login is on the manual checklist.

const users: string[] = [];
test.afterEach(async () => {
  while (users.length) await deleteUser(users.pop()!);
});

const PASSWORD = "Fixture-pass-2026";

async function signIn(page: Page, email: string, password: string, path = "/login") {
  await page.goto(path);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("login page: social buttons only for providers switched on, then the email form", async ({ page }) => {
  const enabled = await authProviders();
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to SignalForge" })).toBeVisible();
  for (const [p, label] of [["google", "Google"], ["github", "GitHub"], ["x", "X"]] as const) {
    const button = page.getByRole("button", { name: `Continue with ${label}` });
    if (enabled[p]) await expect(button).toBeVisible();
    else await expect(button).toHaveCount(0);
  }
  if (enabled.google || enabled.github || enabled.x) await expect(page.getByText("Or continue with email")).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Forgot password?" })).toBeVisible();
});

test("OAuth initiation hands off to the provider (enabled providers only)", async ({ page }) => {
  const enabled = await authProviders();
  const hosts = { google: /accounts\.google\.com/, github: /github\.com\/login/, x: /(x|twitter)\.com/ } as const;
  const on = (Object.keys(hosts) as Array<keyof typeof hosts>).filter((p) => enabled[p]);
  test.skip(on.length === 0, "No social provider is switched on in Supabase yet (see npm run auth:check).");
  for (const p of on) {
    await page.goto("/login");
    const label = { google: "Google", github: "GitHub", x: "X" }[p];
    const [req] = await Promise.all([
      page.waitForRequest((r) => hosts[p].test(r.url())),
      page.getByRole("button", { name: `Continue with ${label}` }).click(),
    ]);
    const url = new URL(req.url());
    // GitHub sign-in never asks for repository access.
    if (p === "github") expect(url.searchParams.get("scope") ?? "").not.toMatch(/repo/);
  }
});

test("OAuth callback errors are explained, never a raw error page", async ({ page }) => {
  await page.goto("/auth/callback?provider=github&error=access_denied&error_description=The+user+denied+the+request");
  await expect(page).toHaveURL(/\/login\?error=oauth_denied&provider=github/);
  await expect(page.getByTestId("auth-notice")).toHaveText(/GitHub sign-in was cancelled/);

  await page.goto("/auth/callback?provider=google");
  await expect(page.getByTestId("auth-notice")).toHaveText(/sign-in link was incomplete/);

  // A code with no PKCE verifier in this browser (finished elsewhere / stale).
  await page.goto("/auth/callback?provider=google&code=00000000-0000-0000-0000-000000000000");
  await expect(page.getByTestId("auth-notice")).toHaveText(/Google sign-in timed out or was finished in a different browser/);

  await page.goto("/login?error=oauth_unavailable&provider=x");
  await expect(page.getByTestId("auth-notice")).toHaveText(/X sign-in isn't available/);
});

test("signup form shows password requirements and validates on the server", async ({ page }) => {
  await page.goto("/signup");
  const rules = page.getByRole("list", { name: "Password requirements" });
  await expect(rules).toContainText("At least 10 characters (not met yet)");
  await page.getByLabel("Password", { exact: true }).fill("abcdefghij1");
  await expect(rules).toContainText("At least 10 characters (met)");
  await expect(rules).toContainText("A number (met)");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Work email").fill("not-an-email");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use at least 10 characters.")).toBeVisible();
  await expect(page.getByLabel("Work email")).toHaveValue("not-an-email");
});

test("signing up with an existing address creates no second account", async ({ page }) => {
  const u = await createPasswordUser(PASSWORD);
  users.push(u.id);
  await page.goto("/signup");
  await page.getByLabel("Work email").fill(u.email);
  await page.getByLabel("Password", { exact: true }).fill("Another-pass-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  // Same answer as a new address (no account enumeration).
  await expect(page).toHaveURL(/\/signup\/check-email/);
  await expect(page.getByRole("heading", { name: "Confirm your email" })).toBeVisible();
  expect(await usersWithEmail(u.email)).toBe(1);
  // The original password still works.
  await signIn(page, u.email, PASSWORD);
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("verification link signs in and lands on onboarding; reuse and expiry are explained", async ({ page, browser }) => {
  const u = await createUnconfirmedUser();
  users.push(u.id);

  await page.goto(u.confirmPath);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Create your workspace" })).toBeVisible();

  // Clicking the same link again in the browser it signed in: carries on.
  await page.goto(u.confirmPath);
  await expect(page).toHaveURL(/\/onboarding$/);

  // The same (now used) link in another browser: explained, with a resend option.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(u.confirmPath);
  await expect(p2).toHaveURL(/\/login\?error=link_expired/);
  await expect(p2.getByTestId("auth-notice")).toHaveText(/expired or was already used/);
  await p2.getByText("Request a new verification link").click();
  await expect(p2.getByRole("button", { name: "Resend verification email" })).toBeVisible();
  await other.close();
});

test("email link errors from Supabase, damaged links and other-browser codes are explained", async ({ page }) => {
  await page.goto("/auth/confirm?next=%2Fonboarding&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  await expect(page).toHaveURL(/\/login\?error=link_expired/);

  await page.goto("/auth/confirm?token_hash=abc&type=bogus");
  await expect(page.getByTestId("auth-notice")).toHaveText(/incomplete or damaged/);

  await page.goto("/auth/confirm?token_hash=pkce_0000000000000000000000000000000000000000000000000000&type=email");
  await expect(page.getByTestId("auth-notice")).toHaveText(/expired or was already used/);

  // Default Supabase template (PKCE code) opened in a browser that didn't sign up.
  await page.goto("/auth/confirm?next=%2Fonboarding&code=00000000-0000-0000-0000-000000000000");
  await expect(page).toHaveURL(/\/login\?error=confirmed_elsewhere/);
  await expect(page.getByTestId("auth-notice")).toHaveText(/different browser/);

  // Recovery code in another browser goes to the reset page with the reason.
  await page.goto("/auth/confirm?next=%2Freset-password&code=00000000-0000-0000-0000-000000000000");
  await expect(page).toHaveURL(/\/forgot-password\?error=recovery_elsewhere/);
});

test("unconfirmed account: sign-in explains and offers a new verification link", async ({ page }) => {
  const u = await createUnconfirmedUser();
  users.push(u.id);
  // Supabase reports "not confirmed" only for the right password, so set a known one.
  await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${u.id}`, {
    method: "PUT",
    headers: { apikey: process.env.SUPABASE_SECRET_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  await signIn(page, u.email, PASSWORD);
  await expect(page.getByText(/Confirm your email first/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Resend verification email" })).toBeVisible();
  // Resend validates the address before asking Supabase (no email sent here).
  await page.getByLabel("Email to confirm").fill("nope");
  await page.getByRole("button", { name: "Resend verification email" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
});

test("email + password: wrong password, success, session persistence, logout", async ({ page }) => {
  const u = await createPasswordUser(PASSWORD);
  users.push(u.id);

  await signIn(page, u.email, "Wrong-pass-2026");
  await expect(page.getByText(/Incorrect email or password/)).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(u.email);

  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.reload();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/login");
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login\?notice=signed_out/);
  await expect(page.getByTestId("auth-notice")).toHaveText("You're signed out.");
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/login\?next=%2Foverview/);
});

test("existing account with a workspace signs in to its dashboard; no duplicate workspace", async ({ page }) => {
  const u = await createUser();
  users.push(u.id);
  await createWorkspaceWithProduct(u);
  await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${u.id}`, {
    method: "PUT",
    headers: { apikey: process.env.SUPABASE_SECRET_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  for (let i = 0; i < 2; i++) {
    await signIn(page, u.email, PASSWORD);
    await expect(page).toHaveURL(/\/overview/);
    await page.context().clearCookies();
  }
  expect(await workspaceCount(u.id)).toBe(1);
});

test("open redirects are refused after sign-in and email links", async ({ page }) => {
  const u = await createPasswordUser(PASSWORD);
  users.push(u.id);
  await signIn(page, u.email, PASSWORD, "/login?next=%2F%2Fevil.example%2Fsteal");
  await expect(page).toHaveURL(/^http:\/\/localhost:3000\//);
  expect(new URL(page.url()).host).toBe("localhost:3000");

  await page.context().clearCookies();
  const v = await createUnconfirmedUser();
  users.push(v.id);
  await page.goto(v.confirmPath.replace("next=/onboarding", "next=https%3A%2F%2Fevil.example"));
  expect(new URL(page.url()).host).toBe("localhost:3000");
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("password reset: request, link, new password, sign in; used link is refused", async ({ page, browser }) => {
  const u = await createPasswordUser(PASSWORD);
  users.push(u.id);

  // Unknown address: same answer, nothing revealed (Supabase sends nothing).
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(`sf-e2e-nobody-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toHaveText(/If an account exists for that email/);

  const link = await recoveryPath(u.email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel("New password", { exact: true }).fill("Brand-new-pass-2026");
  await page.getByLabel("Confirm new password").fill("Brand-new-pass-2026");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page).not.toHaveURL(/reset-password/);

  await page.context().clearCookies();
  await signIn(page, u.email, PASSWORD);
  await expect(page.getByText(/Incorrect email or password/)).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("Brand-new-pass-2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(link);
  await expect(p2).toHaveURL(/\/forgot-password\?error=link_expired/);
  await expect(p2.getByTestId("auth-notice")).toHaveText(/reset link has expired or was already used/);
  await other.close();
});
