# Environment setup

## 1. Supabase project (free tier)

1. Create a project at supabase.com. Note the region (pick one near your users).
2. **Project Settings → API:** copy the Project URL, the *publishable* key (or legacy `anon`), and the *secret* key (or legacy `service_role`).
3. Apply migrations:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-ref>
   npx supabase db push
   ```
   Do **not** run `supabase/tests/harness.sql` against a real project — it is for local tests only.
4. **Authentication → Sign In / Providers → Email:** enable email provider, keep *Confirm email* ON. Minimum password length 10.
5. **Authentication → URL Configuration:** Site URL = your app origin; add `http://localhost:3000/**` and your production origin `/**` to redirect URLs.
6. **Authentication → Email Templates** — make links hit `/auth/confirm` with a token hash so they work across devices:
   - *Confirm signup:* `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding`
   - *Reset password:* `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
   - *Change email address:* `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change`
7. **SMTP:** Supabase's default email sender is heavily rate-limited and intended for testing. Configure a custom SMTP provider before inviting real users (decision deferred to M6; free tiers exist).
8. Free-tier facts that matter (checked 2026-10-14): 500 MB database, 50,000 MAU, 5 GB egress, **projects pause after 1 week of inactivity**, 2 active free projects. A paused project stops cron jobs — fine for development, not for paying customers.

## 2. Google sign-in (optional in development)

1. Google Cloud Console → APIs & Services → OAuth consent screen (External, scopes: email, profile, openid).
2. Credentials → OAuth client ID → Web application. Authorized redirect URI: `https://<your-ref>.supabase.co/auth/v1/callback`.
3. Supabase → Authentication → Providers → Google: paste client ID/secret.
4. If Google isn't configured, the button returns the user to /login with "Google sign-in isn't available".

## 3. Environment variables

Copy `.env.example` to `.env.local` (and set the same in your host's dashboard):

| Variable | Where it's used | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | no |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | no (RLS protects data) |
| `NEXT_PUBLIC_SITE_URL` | auth email/OAuth redirect links | no |
| `SUPABASE_SECRET_KEY` | server only (account deletion, secrets table) | **yes** |
| `CREDENTIALS_ENCRYPTION_KEY` | server only, 32 bytes base64 | **yes** |
| `CREDENTIALS_KEY_VERSION` | server only | no |
| `CREDENTIALS_PREVIOUS_KEYS` | server only, during rotation | **yes** |
| `JOBS_TICK_SECRET` | `POST /api/jobs/tick` (≥ 32 chars; endpoint returns 503 without it) | **yes** |
| `GITHUB_TOKEN` | GitHub issue search — optional; raises the limit from 10 to 30 searches/min | **yes** |
| `STACKEXCHANGE_KEY` | Stack Exchange — optional; raises quota from 300 to 10,000 requests/day | no (app keys are public by design), keep private anyway |
| `YOUTUBE_API_KEY` | YouTube — **required** for that source; without it YouTube shows "Not configured" | **yes** |

Generate the encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
**Back it up.** Losing it makes every stored API key unreadable (users would need to re-enter them).

### Rotating the encryption key
1. Set `CREDENTIALS_PREVIOUS_KEYS=1:<old key>`, `CREDENTIALS_ENCRYPTION_KEY=<new key>`, `CREDENTIALS_KEY_VERSION=2`; deploy.
2. New writes use v2; old rows still decrypt. (A re-encryption job lands with M2's job runner.)
3. After re-encryption, remove the old key.

### Data source keys (all free)
- **GitHub:** github.com → Settings → Developer settings → Fine-grained tokens → *Public repositories (read-only)*, no extra permissions. Put it in `GITHUB_TOKEN`.
- **Stack Exchange:** register an app at stackapps.com/apps/oauth/register; copy the *Key* (not the secret) into `STACKEXCHANGE_KEY`.
- **YouTube:** Google Cloud Console → enable *YouTube Data API v3* → Credentials → API key. Restrict it to that API. Put it in `YOUTUBE_API_KEY`. Default quota: 100 searches/day for the whole project (see API_LIMITATIONS.md).

## 4. Local development

```bash
npm install
npm run dev          # http://localhost:3000
npm run dev:cron     # second terminal: calls the scheduler every 120 s (local stand-in for Supabase Cron)
npm run check        # typecheck + lint + unit tests
npm run test:db      # self-contained: throwaway Postgres 17 from the embedded-postgres dev dependency
npm run test:e2e     # Playwright; uses .env.local's Supabase project with throwaway sf-e2e-* accounts it deletes
```
First E2E run: `npx playwright install chromium`. E2E tests never call external data sources; they insert synthetic fixtures into their own throwaway workspace.

## 5. Hosting

- **Development / private beta:** Vercel Hobby works, but Vercel's Hobby plan is for **non-commercial, personal use only**, and its cron jobs run at most once per day. SignalForge does not rely on Vercel Cron (Supabase Cron triggers the job endpoint), so the cron limit is irrelevant; the commercial-use rule is not.
- **Before charging customers:** move to Vercel Pro (US$20/month per developer seat) or another host that permits commercial use. The app is a standard Next.js server and runs on any Node host.
- Function timeouts: Vercel Hobby allows up to 300 s; job ticks are designed to stop well before that.

## 6. Scheduler

Recurring monitoring is driven by `POST /api/jobs/tick` (header `Authorization: Bearer $JOBS_TICK_SECRET`). Each call: enqueues due monitoring queries (idempotent), runs daily maintenance once per day (retention purge), then works the job queue for up to ~50 s. Calling it more often than needed is harmless.

**Production — Supabase Cron** (Database → Extensions: enable `pg_cron` and `pg_net`; then in the SQL editor):
```sql
select vault.create_secret('<your JOBS_TICK_SECRET>', 'jobs_tick_secret');
select vault.create_secret('https://<your-app-domain>', 'app_url');

select cron.schedule('signalforge-tick', '*/2 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/jobs/tick',
    headers := jsonb_build_object('Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'jobs_tick_secret')),
    timeout_milliseconds := 60000
  );
$$);
```
*Not yet verified on this project* — it needs a publicly reachable deployment (Supabase can't call `localhost`). After deploying, check `select * from cron.job_run_details order by start_time desc limit 5;` and the Integrations → Monitoring activity table.

Every two minutes is ~21,600 calls/month: inside Vercel Hobby's included invocations, and each call returns in milliseconds when nothing is due.

**Development:** `npm run dev:cron`.

**Initial scans** don't wait for the scheduler: starting a scan processes its jobs immediately in the background of that request (`after()`); anything left is picked up by the next tick.
