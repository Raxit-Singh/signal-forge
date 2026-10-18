// Sign-in configuration check (read-only; prints no secrets).
//
//   npm run auth:check                     # uses NEXT_PUBLIC_SITE_URL from .env.local
//   npm run auth:check -- --site https://your-app.vercel.app
//
// Checks the app's environment, which social providers Supabase Auth has
// switched on (public /auth/v1/settings), and — when a Supabase personal access
// token is available (SUPABASE_ACCESS_TOKEN, or ~/.config/signalforge/supabase.env)
// — the dashboard-only settings: Site URL, Redirect URLs allow list, email
// templates and email rate limit. Provider client IDs/secrets live in the
// Supabase dashboard, never in this app's environment.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  OAUTH_PROVIDERS, PROVIDER_LABEL, providersFromSettings, redirectAllowed, templateUsesTokenHash,
} from "../src/lib/auth/flow.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const args = process.argv.slice(2);
const site = (args.includes("--site") ? args[args.indexOf("--site") + 1] : process.env.NEXT_PUBLIC_SITE_URL)?.replace(/\/$/, "");
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let problems = 0;
const ok = (msg: string) => console.log(`  ok    ${msg}`);
const bad = (msg: string, fix: string) => { problems++; console.log(`  FIX   ${msg}\n        → ${fix}`); };
const note = (msg: string) => console.log(`  note  ${msg}`);

console.log("\nApp environment");
for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SITE_URL", "SUPABASE_SECRET_KEY"]) {
  if (process.env[name]) ok(`${name} is set`);
  else bad(`${name} is missing`, "add it to .env.local (and to Vercel → Settings → Environment Variables)");
}
if (site) {
  if (/^https:\/\//.test(site) || /^http:\/\/localhost(:\d+)?$/.test(site)) ok(`Site URL for this check: ${site}`);
  else bad(`Site URL ${site} is not https`, "use the https address people open");
}
if (!SB || !KEY || !site) process.exit(1);

console.log("\nSocial providers (Supabase Auth → Sign In / Providers)");
const res = await fetch(`${SB}/auth/v1/settings`, { headers: { apikey: KEY } });
const settings = res.ok ? await res.json() : null;
const providers = providersFromSettings(settings);
for (const p of OAUTH_PROVIDERS) {
  if (providers[p]) ok(`${PROVIDER_LABEL[p]} is on`);
  else note(`${PROVIDER_LABEL[p]} is off. Its button is hidden until it is switched on (see ENVIRONMENT_SETUP.md §2).`);
}
if (settings?.external?.email !== true) bad("Email sign-in is off", "Supabase → Authentication → Sign In / Providers → Email: enable");
if (settings?.mailer_autoconfirm === true) note("Email confirmation is OFF (mailer_autoconfirm). Accounts are not verified.");
if (settings?.disable_signup === true) note("New sign-ups are disabled.");

let token = process.env.SUPABASE_ACCESS_TOKEN;
const cred = join(homedir(), ".config/signalforge/supabase.env");
if (!token && existsSync(cred)) token = /SUPABASE_ACCESS_TOKEN=(\S+)/.exec(readFileSync(cred, "utf8"))?.[1];
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(SB)?.[1];

console.log("\nDashboard settings (Supabase → Authentication → URL Configuration / Emails)");
if (!token || !ref) {
  note("No SUPABASE_ACCESS_TOKEN: skipped. Check these by hand (ENVIRONMENT_SETUP.md §1).");
} else {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    note(`Couldn't read auth settings (HTTP ${r.status}); check them by hand.`);
  } else {
    const c = await r.json() as Record<string, unknown>;
    const siteUrl = String(c.site_url ?? "");
    const allow = String(c.uri_allow_list ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    note(`Site URL is ${siteUrl}; ${allow.length} redirect URL(s) allowed`);
    for (const path of ["/auth/confirm?next=%2Fonboarding", "/auth/callback?provider=google&next=%2Fonboarding"]) {
      const url = `${site}${path}`;
      if (redirectAllowed(url, siteUrl, allow)) ok(`Supabase accepts redirects to ${site}${path.split("?")[0]}`);
      else bad(`Supabase rejects ${site}${path.split("?")[0]} and falls back to ${siteUrl}`,
        `add "${site}/**" under Redirect URLs (or make it the Site URL)`);
    }
    const templates: Array<[string, string]> = [["Confirm signup", "mailer_templates_confirmation_content"], ["Reset password", "mailer_templates_recovery_content"], ["Magic link", "mailer_templates_magic_link_content"], ["Change email", "mailer_templates_email_change_content"]];
    for (const [label, key] of templates) {
      if (templateUsesTokenHash(c[key] as string)) ok(`"${label}" email links to /auth/confirm with a token hash (works in any browser)`);
      else note(`"${label}" email uses {{ .ConfirmationURL }}: works, but signs in only in the browser that asked for it. Recommended template in ENVIRONMENT_SETUP.md §1.`);
    }
    if (c.smtp_host) ok("Custom SMTP is configured");
    else note(`Built-in email sender: ${c.rate_limit_email_sent ?? "?"} emails/hour for the whole project, and only to team-member addresses. Configure custom SMTP before inviting users.`);
  }
}

console.log(problems ? `\n${problems} setting(s) to fix.\n` : "\nNo blocking problems found.\n");
process.exit(problems ? 1 : 0);
