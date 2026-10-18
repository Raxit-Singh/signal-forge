// Pure sign-in helpers shared by the auth routes, actions and pages. No
// framework imports: unit-tested with `node --test`.

export const OAUTH_PROVIDERS = ["google", "github", "x"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const PROVIDER_LABEL: Record<OAuthProvider, string> = { google: "Google", github: "GitHub", x: "X" };

export function isOAuthProvider(v: unknown): v is OAuthProvider {
  return typeof v === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(v);
}

export type ProviderAvailability = Record<OAuthProvider, boolean>;
export const NO_PROVIDERS: ProviderAvailability = { google: false, github: false, x: false };

/**
 * Reads Supabase Auth's public settings (GET /auth/v1/settings) into which
 * social providers are switched on. Anything unexpected counts as "off", so a
 * button is never shown for a provider Supabase would reject.
 */
export function providersFromSettings(settings: unknown): ProviderAvailability {
  const external = (settings as { external?: Record<string, unknown> } | null)?.external;
  if (!external || typeof external !== "object") return { ...NO_PROVIDERS };
  return { google: external.google === true, github: external.github === true, x: external.x === true };
}

/**
 * Where the provider sends the browser back to. No custom scopes are requested:
 * Supabase's defaults are the minimum for sign-in (Google: openid email profile;
 * GitHub: user:email; X: users.read tweet.read users.email). GitHub sign-in never
 * asks for repository access — that is the separate SignalForge GitHub App.
 */
export function oauthRedirectTo(site: string, provider: OAuthProvider, next: string): string {
  const params = new URLSearchParams({ provider, next });
  return `${site.replace(/\/$/, "")}/auth/callback?${params}`;
}

/** Where an email link (confirm / reset / magic link) lands. */
export function emailRedirectTo(site: string, next: string): string {
  return `${site.replace(/\/$/, "")}/auth/confirm?${new URLSearchParams({ next })}`;
}

export type AuthNoticeKey =
  | "oauth_denied" | "oauth_failed" | "oauth_restart" | "oauth_unavailable" | "missing_code"
  | "invalid_link" | "link_expired" | "confirmed_elsewhere" | "recovery_elsewhere"
  | "provider_email_unverified" | "identity_in_use" | "account_blocked" | "signup_disabled"
  | "reset_expired" | "account_deleted" | "signed_out";

export interface AuthNotice { tone: "error" | "info"; text: string; offerResend?: boolean; offerReset?: boolean }

export function authNotice(key: string | null | undefined, provider?: string | null): AuthNotice | null {
  const p = isOAuthProvider(provider) ? PROVIDER_LABEL[provider] : null;
  const via = p ? `${p} sign-in` : "Sign-in";
  switch (key) {
    case "oauth_denied": return { tone: "error", text: `${via} was cancelled. Nothing was changed.` };
    case "oauth_failed": return { tone: "error", text: `${via} didn't complete. Try again, or use email instead.` };
    case "oauth_restart": return { tone: "error", text: `${via} timed out or was finished in a different browser. Start again from this page.` };
    case "oauth_unavailable": return { tone: "error", text: `${via} isn't available right now. Use email instead.` };
    case "missing_code": return { tone: "error", text: "That sign-in link was incomplete. Start again from this page." };
    case "invalid_link": return { tone: "error", text: "That link is incomplete or damaged. Open the newest email from SignalForge, or request a new link.", offerResend: true };
    case "link_expired": return { tone: "error", text: "That link has expired or was already used. If your email is already confirmed, just sign in. Otherwise request a new link.", offerResend: true, offerReset: true };
    case "confirmed_elsewhere": return { tone: "info", text: "The link was opened in a different browser from the one you signed up in, so you aren't signed in here. Sign in to continue. If it says your email isn't confirmed, request a new link.", offerResend: true };
    case "reset_expired": return { tone: "error", text: "That reset link has expired or was already used. Request a new one below." };
    case "recovery_elsewhere": return { tone: "error", text: "Open the password reset link in the same browser you requested it from, or request a new one below." };
    case "provider_email_unverified": return { tone: "error", text: `${p ?? "The provider"} hasn't verified your email address yet. We've sent a confirmation link to it. Open it, then sign in again.` };
    case "identity_in_use": return { tone: "error", text: `That ${p ?? "provider"} account already belongs to another SignalForge account. Sign in with that account instead.` };
    case "account_blocked": return { tone: "error", text: "This account can't sign in right now. Contact support." };
    case "signup_disabled": return { tone: "error", text: "New sign-ups are closed right now. If you already have an account, sign in with the method you used before." };
    case "account_deleted": return { tone: "info", text: "Your account and its data have been deleted." };
    case "signed_out": return { tone: "info", text: "You're signed out." };
    default: return null;
  }
}

/**
 * Supabase sends failures back as query parameters (error, error_code,
 * error_description) on the redirect. Maps them to a notice the login page
 * explains. `context` decides the fallback for unknown codes.
 */
export function noticeForAuthError(
  e: { error?: string | null; code?: string | null; description?: string | null },
  context: "oauth" | "email",
): AuthNoticeKey {
  const code = e.code ?? "";
  const desc = (e.description ?? "").toLowerCase();
  if (code === "otp_expired" || desc.includes("expired")) return "link_expired";
  if (code === "provider_email_needs_verification") return "provider_email_unverified";
  if (code === "identity_already_exists" || code === "email_exists" || code === "user_already_exists") return "identity_in_use";
  if (code === "user_banned") return "account_blocked";
  if (code === "signup_disabled") return "signup_disabled";
  if (code === "provider_disabled" || code === "oauth_provider_not_supported" || desc.includes("not enabled")) return "oauth_unavailable";
  if (["flow_state_expired", "flow_state_not_found", "bad_oauth_state", "bad_code_verifier", "pkce_code_verifier_not_found"].includes(code)) {
    return "oauth_restart";
  }
  if (e.error === "access_denied" && context === "oauth") return "oauth_denied";
  return context === "oauth" ? "oauth_failed" : "invalid_link";
}

/**
 * Converts Supabase's allow-list glob (`*` = within one host label or path
 * segment, `**` = anything) into a RegExp, as GoTrue matches redirect URLs.
 */
export function redirectPatternToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*" && pattern[i + 1] === "*") { re += ".*"; i++; }
    else if (c === "*") re += "[^./]*";
    else if (c === "?") re += "[^./]";
    else re += c.replace(/[.+^${}()|[\]\\/]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/**
 * Whether Supabase Auth would honour a redirect URL: same host as the Site URL,
 * or matching an allow-list entry. If not, Supabase silently falls back to the
 * Site URL — which is how verification links ended up on localhost.
 */
export function redirectAllowed(url: string, siteUrl: string, allowList: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
    if (host === new URL(siteUrl).hostname) return true;
  } catch {
    return false;
  }
  return allowList.some((p) => p.trim() !== "" && redirectPatternToRegExp(p.trim()).test(url));
}

/**
 * Whether an email template sends a token hash to /auth/confirm (works in any
 * browser): either `{{ .RedirectTo }}&token_hash=…` (recommended: follows the
 * site that asked) or `{{ .SiteURL }}/auth/confirm?token_hash=…`.
 */
export function templateUsesTokenHash(html: string | null | undefined): boolean {
  if (!html) return false;
  return /\{\{\s*\.RedirectTo\s*\}\}&(amp;)?token_hash=\{\{\s*\.TokenHash\s*\}\}/.test(html)
    || /\/auth\/confirm\?token_hash=\{\{\s*\.TokenHash\s*\}\}/.test(html);
}
