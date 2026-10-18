import { test } from "node:test";
import assert from "node:assert/strict";

import {
  authNotice, emailRedirectTo, isOAuthProvider, noticeForAuthError, oauthRedirectTo, providersFromSettings,
  redirectAllowed, redirectPatternToRegExp, templateUsesTokenHash,
} from "./flow.ts";
import { safeRedirectPath } from "../domain/urls.ts";

test("providersFromSettings reads only explicit true flags", () => {
  assert.deepEqual(providersFromSettings({ external: { google: true, github: false, x: true, twitter: true, email: true } }),
    { google: true, github: false, x: true });
  assert.deepEqual(providersFromSettings({ external: { google: "true" } }), { google: false, github: false, x: false });
  assert.deepEqual(providersFromSettings(null), { google: false, github: false, x: false });
  assert.deepEqual(providersFromSettings({ msg: "error" }), { google: false, github: false, x: false });
});

test("isOAuthProvider accepts only the supported providers", () => {
  assert.ok(isOAuthProvider("google") && isOAuthProvider("github") && isOAuthProvider("x"));
  assert.ok(!isOAuthProvider("twitter") && !isOAuthProvider("facebook") && !isOAuthProvider(null));
});

test("OAuth and email redirects stay on the site and carry a safe next path", () => {
  assert.equal(oauthRedirectTo("https://app.example/", "github", "/onboarding"),
    "https://app.example/auth/callback?provider=github&next=%2Fonboarding");
  assert.equal(emailRedirectTo("https://app.example", "/invite/abc?x=1"),
    "https://app.example/auth/confirm?next=%2Finvite%2Fabc%3Fx%3D1");
  // The next path is sanitised by the caller; an attacker-chosen absolute URL never survives.
  assert.equal(safeRedirectPath("https://evil.example", "/onboarding"), "/onboarding");
  assert.equal(safeRedirectPath("//evil.example", "/onboarding"), "/onboarding");
  assert.equal(safeRedirectPath("/\\evil.example", "/onboarding"), "/onboarding");
  assert.equal(safeRedirectPath("javascript:alert(1)", "/onboarding"), "/onboarding");
  assert.equal(safeRedirectPath("/overview\n", "/onboarding"), "/onboarding");
});

test("Supabase error redirects map to specific, recoverable notices", () => {
  assert.equal(noticeForAuthError({ error: "access_denied", code: "otp_expired", description: "Email link is invalid or has expired" }, "email"), "link_expired");
  assert.equal(noticeForAuthError({ error: "access_denied", description: "The user denied the request" }, "oauth"), "oauth_denied");
  assert.equal(noticeForAuthError({ code: "provider_email_needs_verification" }, "oauth"), "provider_email_unverified");
  assert.equal(noticeForAuthError({ code: "identity_already_exists" }, "oauth"), "identity_in_use");
  assert.equal(noticeForAuthError({ code: "flow_state_expired" }, "oauth"), "oauth_restart");
  assert.equal(noticeForAuthError({ code: "pkce_code_verifier_not_found" }, "oauth"), "oauth_restart");
  assert.equal(noticeForAuthError({ description: "Unsupported provider: provider is not enabled" }, "oauth"), "oauth_unavailable");
  assert.equal(noticeForAuthError({ code: "user_banned" }, "oauth"), "account_blocked");
  assert.equal(noticeForAuthError({ code: "something_new" }, "oauth"), "oauth_failed");
  assert.equal(noticeForAuthError({ code: "something_new" }, "email"), "invalid_link");
});

test("authNotice names the provider and never shows a generic 'something went wrong'", () => {
  assert.match(authNotice("oauth_denied", "github")!.text, /^GitHub sign-in was cancelled/);
  assert.match(authNotice("oauth_unavailable", "google")!.text, /^Google sign-in isn't available/);
  assert.match(authNotice("oauth_failed", "evil")!.text, /^Sign-in didn't complete/);
  assert.equal(authNotice("link_expired")!.offerResend, true);
  assert.equal(authNotice("unknown_code"), null);
  for (const key of ["oauth_denied", "oauth_failed", "oauth_restart", "invalid_link", "link_expired", "confirmed_elsewhere", "recovery_elsewhere", "reset_expired"]) {
    assert.doesNotMatch(authNotice(key)!.text, /something went wrong/i, key);
  }
});

test("redirect allow-list matching follows Supabase's glob rules", () => {
  const site = "http://localhost:3000";
  // The production misconfiguration: an exact entry without ** doesn't cover paths.
  assert.equal(redirectAllowed("https://app.vercel.app/auth/confirm?next=%2Fonboarding", site, ["https://app.vercel.app/"]), false);
  assert.equal(redirectAllowed("https://app.vercel.app/auth/confirm?next=%2Fonboarding", site, ["https://app.vercel.app/**"]), true);
  assert.equal(redirectAllowed("http://localhost:3000/auth/callback?x=1", site, []), true);
  assert.equal(redirectAllowed("https://preview-1.vercel.app/auth/callback", site, ["https://*.vercel.app/**"]), true);
  assert.equal(redirectAllowed("https://evil.com/x.vercel.app/auth", site, ["https://*.vercel.app/**"]), false);
  assert.equal(redirectAllowed("not a url", site, ["**"]), false);
  assert.ok(redirectPatternToRegExp("https://a.b/*").test("https://a.b/x"));
  assert.ok(!redirectPatternToRegExp("https://a.b/*").test("https://a.b/x/y"));
});

test("templateUsesTokenHash recognises the cross-browser email template", () => {
  assert.ok(templateUsesTokenHash('<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding">Confirm</a>'));
  assert.ok(templateUsesTokenHash('<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Confirm</a>'));
  assert.ok(!templateUsesTokenHash('<a href="{{ .ConfirmationURL }}">Confirm</a>'));
  assert.ok(!templateUsesTokenHash(null));
});
