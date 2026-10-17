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
| `API_DIRECT_API_KEY` | Paid sources (Reddit, X, LinkedIn, TikTok, Instagram, Facebook, Substack, web, news, Trustpilot). Server only; sent as `X-API-Key`, never logged | **yes** |
| `PAID_SOURCES_ENABLED` | `true` to allow paid collection at all (default `false`). Also needs a global budget row — see §3b | no |

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

### 3b. Paid sources — API Direct (optional; costs money)

Paid collection needs **all three**: `API_DIRECT_API_KEY`, `PAID_SOURCES_ENABLED=true`, and a global monthly budget in the database. With any one missing, paid sources show "Not configured" / "switched off" and no paid request is made.

1. Create an account at apidirect.io, add a payment method, and **set daily and monthly spending limits in its billing dashboard** (a second, provider-side cap). Create an API key (`ak_live_…`) and put it in `API_DIRECT_API_KEY` on the server only.
2. Set budgets (SQL editor, service role). Amounts are US$ per calendar month (UTC):
   ```sql
   insert into public.api_budgets (scope, monthly_limit_usd, note) values ('global', 10, 'all paid sources');
   -- optional caps:
   insert into public.api_budgets (scope, provider, monthly_limit_usd) values ('provider', 'apidirect', 10);
   insert into public.api_budgets (scope, platform, monthly_limit_usd) values ('platform', 'x', 3);
   insert into public.api_budgets (scope, workspace_id, monthly_limit_usd) values ('workspace', '<uuid>', 2);
   -- per-plan internal paid budget (set by migration 20261016000005: free 0, pro 25, scale 75):
   update public.plan_paid_allowances set monthly_usd = 25, max_boost_paid_checks = 400 where plan_id = 'pro';
   -- separate searches per check on paid platforms without OR (TikTok, Instagram, Facebook, Substack); free/pro 2, scale 4:
   update public.plan_paid_allowances set max_searches_per_platform = 4 where plan_id = 'scale';
   ```
   How often each platform is checked is automatic (Smart Monitoring): never faster than the plan's `monitoring_interval_minutes` (Free 24 h, Pro/Scale 1 h), shortened toward the plan's keyword refresh target and lengthened when needed to keep within the paid budget; there is no per-product mode to configure. Before enabling, `npm run audit:keywords` shows the searches and estimated monthly cost per product (read-only).
3. Set `PAID_SOURCES_ENABLED=true` and redeploy. Each product admin must still turn each paid platform on (Smart Monitoring → More platforms) and confirm the spending authorization.
4. **Live validation** (authorized, capped, never in CI): first `node scripts/apidirect-live-test.ts --plan --max-usd 0.05` (prints the plan and worst-case cost, sends nothing), then `npm run test:apidirect-live -- --confirm --max-usd 0.05 --provider-limit-confirmed [--session <name>]`. It refuses without the key, with `PAID_SOURCES_ENABLED=true`, or without the provider-limit confirmation (API Direct can't report its limits via API). Every request is reserved in `api_cost_ledger` (purpose `live_test`) before it is sent, and the cap is **cumulative per session** across runs. It writes nothing to `mentions`; raw responses and a report go to `.apidirect-live/` (gitignored). Done once on 2026-10-16 ($0.048) — see API_LIMITATIONS.md.
5. **Reconciliation** (monthly): compare the API Direct invoice with the ledger and record it:
   ```sql
   insert into public.billing_reconciliations (provider, period_start, invoiced_usd, estimated_usd, charged_usd)
   select 'apidirect', date '2026-10-01', <invoice total>, sum(estimated_usd), sum(coalesce(charged_usd, estimated_usd))
     from public.api_cost_ledger where period_start = date '2026-10-01' and status <> 'released';
   ```
   Per-request detail (platform, endpoint, purpose, status, billed units, results, relevant mentions, duplicates, duration) is in `api_cost_ledger`; cost per workspace/product via `api_cost_allocations`.

Prices change in one place: insert a row into `provider_pricing` with a new `effective_from`.

### 3b-2. Supabase CLI without the macOS Keychain

```bash
bash scripts/supabase-auth-setup.sh                # hidden prompts: access token (sbp_…) and, optionally, the DB password
bash scripts/supabase-cli.sh db push --dry-run     # refuses unless the linked project = the project in .env.local
bash scripts/supabase-cli.sh db push
```

- Credentials are kept in `~/.config/signalforge/supabase.env` (mode 600, outside the repo). They are passed to the CLI only as environment variables, never printed.
- To revoke, delete the token in the Supabase dashboard and remove the file.

### 3c. SignalForge Intelligence — Gemini (optional; costs money; ask the founder first)

SignalForge pays for this; customers never connect an AI provider for it.

1. Create a Gemini API key in Google AI Studio (paid tier) and set the server-only variables (see `.env.example`):
   `SIGNALFORGE_AI_ENABLED=true`, `SIGNALFORGE_AI_PROVIDER=gemini`, `SIGNALFORGE_GEMINI_API_KEY`, `SIGNALFORGE_AI_MODEL`
   (e.g. `gemini-3.1-flash-lite`), optionally `SIGNALFORGE_AI_DEEP_MODEL` and `SIGNALFORGE_EMBEDDING_MODEL` (`gemini-embedding-2`).
   Model ids must exist in `src/lib/ai/pricing.ts`; a model without a known price is refused.
2. Set the operator's monthly limit (nothing is spent without it):
   `insert into public.ai_global_budget (monthly_limit_usd, note) values (<usd>, '<who/why>');`
3. Each workspace is also capped by its plan's `monthly_ai_token_budget` (Free 0, Pro 8M, Scale 30M tokens). Every call is reserved before it is made and settled after.
4. AI relevance runs in **shadow mode**: it never changes `relevance_status` or the mention allowance. Review precision/recall in Settings → SignalForge Intelligence before deciding otherwise.

**Test classifier (development only):** Settings → SignalForge Intelligence → "Use test classifier". A keyword heuristic with hashed-word embeddings, no calls, no cost, labelled as test output; unavailable when `NODE_ENV=production` or on Vercel preview/production.

### 3d. Developer agent — Claude connector, GitHub App, routines

**Claude connector (MCP).** Nothing to configure server-side except a public HTTPS `NEXT_PUBLIC_SITE_URL` (Claude can't reach localhost). Customers add `<site>/api/mcp` as a custom connector in Claude and approve in SignalForge. Endpoints: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/api/oauth/{register,token,revoke}`, `/oauth/authorize`.

**GitHub App** (repository authorization; separate from `GITHUB_TOKEN`):
1. Create a GitHub App: permissions **Metadata: read, Contents: read, Pull requests: read** only; no webhook needed.
2. Setup URL: `<site>/api/github/callback`; enable **"Request user authorization (OAuth) during installation"** (SignalForge uses the install-time user token to prove the installer can access the installation); callback URL the same.
3. Generate a private key; set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` (PEM, `\n` for newlines).

**Claude Code routine** (optional, per customer, on their Claude plan): created by the customer at claude.ai/code/routines with the prompt shown in Settings → Developer agent; they paste the API trigger URL and token. The token is encrypted (`credential_secrets`, purpose `agent`).

**Development:** `/api/dev/mock-routine/<trig_id>/fire` stands in for Claude's fire endpoint (404 in production builds); browser tests use it.

## 4. Local development

```bash
npm install
npm run dev          # http://localhost:3000 — also runs the job scheduler every 120 s (src/instrumentation.ts)
npm run check        # typecheck + lint + unit tests
npm run test:db      # self-contained: throwaway Postgres 17 from the embedded-postgres dev dependency
npm run test:e2e     # Playwright; uses .env.local's Supabase project with throwaway sf-e2e-* accounts it deletes
npm run audit:keywords  # read-only keyword/query/cost report per product (no platform API calls)
node scripts/resync-queries.ts --product <uuid> [--apply]   # re-plan one product's query groups now (dry run by default)
```
**Testing faster intervals (development only):** add to `.env.local` and restart `npm run dev`:
```
DEV_MONITORING_MIN_INTERVAL_MINUTES=60
DEV_MONITORING_WORKSPACES=<your workspace uuid>
```
It lowers only the plan's minimum interval for the listed workspaces, only under `next dev` (never in production builds or Vercel deployments). API budgets, paid allowances, rate limiters and source minimums (YouTube 24 h) still apply; Smart Monitoring shows a notice while it is active.
E2E creates several accounts in quick succession; Supabase Auth's verify rate limit (429 `over_request_rate_limit`) can fail a second full run started right after the first. Wait a few minutes and rerun.
First E2E run: `npx playwright install chromium`. E2E tests never call external data sources; they insert synthetic fixtures into their own throwaway workspace. No automated test makes a paid request: API Direct connectors are tested with mocked responses only (one manual, capped live validation is recorded in API_LIMITATIONS.md).

**Plans and usage in development:** plan rows are data (`plans`, `plan_paid_allowances`). To give a SignalForge-owned test workspace Pro or Scale limits **without a subscription**, use an internal grant (nothing billed; `subscriptions` untouched; refuses workspaces with a payment-provider subscription):
```bash
node scripts/grant-internal-plan.ts --workspace <uuid> --plan pro            # dry run
node scripts/grant-internal-plan.ts --workspace <uuid> --plan pro --apply   # optional --days N
node scripts/grant-internal-plan.ts --workspace <uuid> --revoke --apply
```
Then re-plan its products (`node scripts/resync-queries.ts --product <uuid> --apply`). Billing shows "Internal testing entitlement — not a paid subscription". Paid collection still needs `PAID_SOURCES_ENABLED=true` and a global budget. `node scripts/simulate-plan-costs.ts` estimates Pro/Scale paid cost, mentions found, completeness, keyword freshness and historical-backfill cost with the V2 engine (read-only; `--v1` = previous engine, `--json` = full detail). `/settings/billing` shows the current period's mention usage, keyword allowance and plan options; warnings appear app-wide at 80 / 90 / 100 %.

## 5. Hosting

- **Development / private beta:** Vercel Hobby works, but Vercel's Hobby plan is for **non-commercial, personal use only**, and its cron jobs run at most once per day. SignalForge does not rely on Vercel Cron (Supabase Cron triggers the job endpoint), so the cron limit is irrelevant; the commercial-use rule is not.
- **Before charging customers:** move to Vercel Pro (US$20/month per developer seat) or another host that permits commercial use. The app is a standard Next.js server and runs on any Node host.
- Function timeouts: Vercel Hobby allows up to 300 s; job ticks are designed to stop well before that.

## 6. Scheduler

Recurring monitoring is driven by `POST /api/jobs/tick` (header `Authorization: Bearer $JOBS_TICK_SECRET`). Each call: enqueues due monitoring queries (idempotent; interval chosen per query group by the adaptive engine), runs daily maintenance once per day (retention purge, query-group re-sync for every product), runs spike detection once per hour, then works the job queue for up to ~50 s. Calling it more often than needed is harmless.

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

**Development:** `npm run dev` ticks the scheduler itself every 120 s (`src/instrumentation.ts`, development only; `DEV_SCHEDULER=off` disables it). `npm run dev:cron` remains for driving a server started some other way (e.g. `next start`). There is no manual scan button: collection runs only on each keyword's schedule.

## Realtime dashboard updates (2026-10-16)

Migration `20261016000007` adds `public.workspace_events` to the `supabase_realtime` publication (skipped automatically on plain Postgres). Nothing else to configure on Supabase: Realtime is on by default, and postgres_changes applies each subscriber's RLS, so members receive only their workspace's events (counts only). Check it in the dashboard: **Database → Publications → supabase_realtime** should list `workspace_events`. If Realtime is unavailable, pages fall back to refreshing every 60 s while visible ("Reconnecting" indicator). The table is purged daily (events older than a day).

## Historical search (2026-10-16)

Customers choose the period at onboarding (step 5) or on **Smart Monitoring → Historical search**. Steps run from the scheduler (`/api/jobs/tick` also schedules due backfill tasks), so the scheduler (the dev server's own ticker locally, Supabase Cron in production) must be running for a search to progress beyond its first batch. Paid platforms wait ("paused") while `PAID_SOURCES_ENABLED` is not `true`; every step goes through the same budget reservation and mention allowance as monitoring.

## Staff cost dashboard

`SIGNALFORGE_STAFF_EMAILS` (comma-separated) lists the verified account emails that may open `/admin/costs`, an internal, read-only view of what SignalForge spends on Gemini and API Direct this month against the operator limits. Leave it empty in any environment where nobody should see it; non-staff get a 404.

## Discord source (optional)

Create an application at https://discord.com/developers/applications:
1. **Bot** → reset/copy the token (`DISCORD_BOT_TOKEN`); turn on **Message Content Intent** (Discord requires approval once the bot is in 100+ servers). Leave "Public Bot" on so customers can add it.
2. **OAuth2** → copy Client ID (`DISCORD_CLIENT_ID`) and Client Secret (`DISCORD_CLIENT_SECRET`); add the redirect `https://<your site>/api/discord/callback` and turn on **Requires OAuth2 Code Grant** (SignalForge confirms the server through the code exchange).
3. Set the three variables and restart. Customers then use Integrations → "Add bot to Discord". The bot asks only for View Channels and Read Message History.

## Google Play source

Nothing to configure on the server. Each customer connects their own Play Console on the Integrations page with a Google Cloud service account JSON key invited in Play Console with "View app information", and sets the product's Google Play URL.

## Stripe (subscriptions)

Test mode first:
1. Stripe Dashboard (test mode) → Developers → API keys: copy the secret key into `STRIPE_SECRET_KEY=sk_test_…`.
2. `node scripts/stripe-setup.ts` (dry run), then `node scripts/stripe-setup.ts --apply` — creates the Pro and Scale prices from the plans table and the billing portal configuration.
3. Webhooks: locally `stripe listen --forward-to localhost:3000/api/stripe/webhook` prints a `whsec_…` secret for `STRIPE_WEBHOOK_SECRET`; deployed, add an endpoint `https://<site>/api/stripe/webhook` with events `checkout.session.completed`, `customer.subscription.created/updated/deleted/paused/resumed` and use its signing secret.
4. Pay with test card 4242 4242 4242 4242. Going live repeats this with live keys (`--apply --live`) — only after the founder approves.
