# Security review (pre-launch, 2026-10-18)

What was checked, what was changed, and what still needs a human before real customers. Nothing here replaces an external penetration test.

## Checked and in place

**Tenancy and data access**
- Every customer table has row-level security; membership is evaluated once per query (`private.user_workspace_ids`). 394 database tests cover isolation between workspaces, role limits (viewer / member / admin / owner) and service-only functions.
- Writes that need extra rules go through `SECURITY DEFINER` functions that check the caller's role first (competitors, invitations, members, workspace creation, held mentions). Supabase's advisor lists these 12 as "executable by authenticated" — intended; each has permission tests.
- Service-role (`createAdminClient`) use happens only after an explicit authorization check in the same action or route; every exported server action was reviewed (sign-in actions are pre-auth by design; the rest check a role directly, through a helper, or through a role-checking function / the user's own RLS client).
- Secrets (data-source keys, Google Play keys, routine tokens) are AES-256-GCM encrypted per workspace, decrypted only at use, never returned to the browser or logged. Token hashes (invitations, OAuth) are stored, not tokens.

**Web**
- Content Security Policy with a per-request nonce and `strict-dynamic` (no `unsafe-eval` in production; inline styles allowed for charts); `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action` limited to SignalForge, Supabase Auth, the Google, GitHub and X sign-in pages, Stripe and Discord. No violations on the main pages in development or a production build.
- HSTS (2 years, preload), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`; `poweredByHeader` off.
- Server actions reject cross-origin POSTs (Next.js); redirects after sign-in use `safeRedirectPath` (same-origin paths only).
- Inbound webhooks and callbacks verify signatures or signed state: Stripe (signature over the raw body, 5-minute tolerance, idempotent per event), Discord and GitHub installs (HMAC state bound to the user + code exchange), scheduler (`JOBS_TICK_SECRET`, constant-time compare), unsubscribe links (HMAC; GET only confirms).
- No server-side fetch of user-supplied URLs except Claude routine URLs, which must match Anthropic's documented pattern.
- Email templates escape all user- and post-derived text; subjects are single-line; reports' CSV export neutralises spreadsheet formulas.

**AI and external content**
- Collected posts are passed to models as quoted, untrusted data; outputs are schema-validated and must cite stored posts; GitHub issue drafts are assembled by code (no model-written links or @mentions). SignalForge never writes to customer repositories.

**Abuse and cost**
- Plan limits are enforced in the database; AI spend is reserved before each call against a global monthly limit (records survive workspace deletion); paid data has global/provider/workspace budgets; invitations are limited to 30 per workspace per day.

## Changed in this review
- CSP added (`src/proxy.ts`), nonce passed to the theme script.
- `public.rls_auto_enable()` (Supabase's auto-RLS event trigger function) no longer executable by `anon`/`authenticated`.
- Invitation rate limit.

## Needs a human before launch
1. **Supabase Auth**: turn on *Leaked password protection* (Authentication → Passwords; flagged by the advisor), set the minimum password length to at least 10 to match the app, require email confirmation, and configure custom SMTP (Resend) so auth emails aren't rate-limited.
2. **Secrets for production**: new values for `CREDENTIALS_ENCRYPTION_KEY`, `JOBS_TICK_SECRET`, Stripe live keys and webhook secret, Resend key — none of the development values.
3. **Staff list**: set `SIGNALFORGE_STAFF_EMAILS` to the founder's account only.
4. **Hosting**: commercial-use hosting (Vercel Pro or equivalent), HTTPS only, Supabase project on a paid plan (free projects pause).
5. **External review**: a penetration test / dependency audit once deployed (`npm audit` reports 0 production vulnerabilities today).
6. **Performance advisor**: five tables have both a read and an all-actions policy for SELECT (minor overhead; can be split into per-action policies).
