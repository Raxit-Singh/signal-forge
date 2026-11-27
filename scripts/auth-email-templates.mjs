// Builds the Supabase Auth email templates (sign-up confirmation, password reset, magic link, email change) from one
// layout, into supabase/templates/. Paste each file's HTML and subject into Supabase → Authentication → Emails →
// Templates (editing them needs custom SMTP, see ENVIRONMENT_SETUP.md). Links carry a token hash to /auth/confirm, so
// they work on any device. They are sent from hello@heardex.com, which takes no replies, so the footer points to
// support@heardex.com.
//
//   node scripts/auth-email-templates.mjs
//
// Email-safe HTML: tables, inline styles, no scripts or web fonts; reads the same in Gmail, Outlook and Apple Mail.
import { mkdirSync, writeFileSync } from "node:fs";

const SITE = "https://www.heardex.com";
const SUPPORT = "support@heardex.com";
const INK = "#0b0b0c";
const MUTED = "#63636b";
const LINE = "#e4e4e8";
const RED = "#dc2f22";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One email: a heading, a sentence or two, one button, the plain link and why they got it. */
function layout({ preheader, heading, body, button, link, note }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f6f6f7;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f6f7;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr>
          <td style="padding:0 4px 20px 4px;">
            <a href="${SITE}" style="text-decoration:none;color:${INK};font-family:${FONT};font-size:18px;font-weight:600;letter-spacing:-0.3px;">
              <img src="${SITE}/apple-icon.png" width="28" height="28" alt="" style="vertical-align:middle;border:0;border-radius:7px;margin-right:8px;">heardex
            </a>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border:1px solid ${LINE};border-radius:16px;padding:36px 32px;font-family:${FONT};color:${INK};">
            <div style="width:32px;height:3px;background:${RED};border-radius:2px;margin:0 0 24px 0;"></div>
            <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.3px;">${esc(heading)}</h1>
            <p style="margin:0 0 28px 0;font-size:15px;line-height:1.6;color:${INK};">${body}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-radius:10px;background:${INK};">
                  <a href="${link}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(button)}</a>
                </td>
              </tr>
            </table>
            <p style="margin:28px 0 0 0;font-size:13px;line-height:1.6;color:${MUTED};">${note}</p>
            <p style="margin:20px 0 0 0;padding-top:20px;border-top:1px solid ${LINE};font-size:12px;line-height:1.6;color:${MUTED};">
              Button not working? Copy this link into your browser:<br>
              <a href="${link}" style="color:${MUTED};word-break:break-all;">${link}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 4px 0 4px;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">
            Heardex, product feedback from public posts, ranked. Vadodara, Gujarat, India.<br>
            This address doesn't receive replies. Questions or a problem? Write to <a href="mailto:${SUPPORT}" style="color:${MUTED};">${SUPPORT}</a> or visit <a href="${SITE}" style="color:${MUTED};">heardex.com</a>.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}

// {{ .RedirectTo }} is the /auth/confirm?next=… address the app passed (it already has a "?"), so links follow
// whichever site sent them. Email change has no redirect, so it uses the site URL.
const TEMPLATES = [
  {
    file: "confirm-signup.html",
    supabase: "Confirm signup",
    subject: "Confirm your email for Heardex",
    preheader: "One click to finish creating your Heardex account.",
    heading: "Confirm your email",
    body: "Thanks for signing up for Heardex. Confirm that <strong>{{ .Email }}</strong> is your address to finish creating your account.",
    button: "Confirm email",
    link: "{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email",
    note: "The link works for one hour, on any device. If you didn't sign up for Heardex, you can ignore this email: nothing happens until the address is confirmed.",
  },
  {
    file: "reset-password.html",
    supabase: "Reset password",
    subject: "Reset your Heardex password",
    preheader: "Choose a new password for your Heardex account.",
    heading: "Reset your password",
    body: "We got a request to reset the password for <strong>{{ .Email }}</strong>. Choose a new one with the button below.",
    button: "Choose a new password",
    link: "{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery",
    note: "The link works for one hour and only once. If you didn't ask for this, ignore this email: your password stays the same.",
  },
  {
    file: "magic-link.html",
    supabase: "Magic link",
    subject: "Your Heardex sign-in link",
    preheader: "Sign in to Heardex with one click.",
    heading: "Sign in to Heardex",
    body: "Use the button below to sign in as <strong>{{ .Email }}</strong>.",
    button: "Sign in",
    link: "{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email",
    note: "The link works for one hour and only once. If you didn't ask to sign in, ignore this email.",
  },
  {
    file: "change-email.html",
    supabase: "Change email address",
    subject: "Confirm your new email address for Heardex",
    preheader: "Confirm the new address for your Heardex account.",
    heading: "Confirm your new email address",
    body: "You asked to change your Heardex sign-in address from <strong>{{ .Email }}</strong> to <strong>{{ .NewEmail }}</strong>. Confirm the change with the button below.",
    button: "Confirm new address",
    link: "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change",
    note: "If you didn't ask for this, ignore this email and your address stays the same.",
  },
];

const dir = new URL("../supabase/templates/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const t of TEMPLATES) writeFileSync(new URL(t.file, dir), layout(t));
writeFileSync(new URL("README.md", dir), [
  "# Supabase Auth email templates",
  "",
  "Generated by `node scripts/auth-email-templates.mjs`; edit the script, not these files. Paste each into",
  "Supabase → Authentication → Emails → Templates (needs custom SMTP; see ENVIRONMENT_SETUP.md).",
  "",
  "| Supabase template | Subject | File |",
  "|---|---|---|",
  ...TEMPLATES.map((t) => `| ${t.supabase} | ${t.subject} | \`${t.file}\` |`),
  "",
].join("\n"));
console.log(`Wrote ${TEMPLATES.length} templates to supabase/templates/`);
