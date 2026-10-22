# Progress

Legend: ✅ verified by an automated check that ran · 🟡 written, not yet executed · ⬜ not started

## Verification run (2026-10-14, macOS arm64, Node 24.14)

| Check | Result |
|---|---|
| `npm run test:unit` | ✅ 33/33 |
| `npm run test:db` (Postgres 17, all migrations + `rls_test.sql`) | ✅ 87/87 |
| `npm run typecheck` | ✅ clean |
| `npm run lint` | ✅ clean |
| `npm run build` (Next.js 16.4, Turbopack) | ✅ 32 routes |
| Browser walk-through against the linked Supabase project | ✅ see M1 acceptance flow below |
| Live isolation script against the linked project (two real users, their own JWTs, public REST API) | ✅ 11/11 |

Test users created for the walk-through were removed afterwards via the app's own deletion path.

## Paid-source cost cuts (2026-10-22)

Measured on the ledger: **30% of API Direct spend ($0.52 of $1.72) bought calls that returned nothing.** Fixes:

- ✅ **Pages:** a page-billed request asks for one page when the search's results are mostly unrelated (fewer than 2 relevant per page, `relevantShare`).
- ✅ **History:** the first job of a history task buys at most 2 pages (Facebook history had bought 7 pages for 5 results).
- ✅ **Escalation:** skipped when under 25% of the first pages mention a keyword (TikTok's fuzzy "tonguing" results).
- ✅ **Permanent failures:** no longer retried *sooner*. "Not found" (e.g. no Trustpilot page) waits a week; a rejected search waits a day; history tasks stop at once.
  - Trustpilot had been re-bought 16 times for a business that isn't on Trustpilot.
- ✅ **Busy-but-irrelevant searches:** a paid search whose results are under 10% relevant no longer forces hourly checks to avoid overflow.
- ✅ **Serper for Web + News** (`src/lib/sources/serper/`):
  - migration `20261022000002` (applied to dev) registers serper prices;
  - paid requests now support POST;
  - 🟡 not yet run live: waiting for `SERPER_API_KEY`.
- **Estimate on the same calls as so far:** $1.72 → ~$0.76 (−56%), with TikHub (X, TikTok) and Serper (Web, News).

**Tests:** unit 299, DB 414.

## TikHub as a second paid provider for X and TikTok (2026-10-22)

- ✅ **Live probe** (`scripts/tikhub-probe.ts`; probe + comparisons ≈ $0.04 of the $5 test balance):
  - key works; listed prices confirmed against the balance;
  - failed calls cost nothing;
  - Reddit search is broken on TikHub;
  - X ignores "Latest" sorting but honours `since:`/`until:`;
  - TikTok and Instagram ids match API Direct's.
- ✅ **Same search on both providers** (Gears of War, 7 days):

  | Platform | TikHub | API Direct |
  |---|---|---|
  | X | 16/17 relevant ($0.001) | 18/20 ($0.006) |
  | TikTok | 20/20 ($0.001) | 30/30 ($0.006) |
  | Instagram | 0 recent | 1 recent |

- ✅ **Implementation:**
  - `src/lib/sources/tikhub/`: client, normalizers, search adapters;
  - `TIKHUB_PLATFORMS` swaps only the search of x/tiktok/instagram, so comment expansion, streams and checkpoints stay on the API Direct adapter;
  - migration `20261022000001` widens provider checks and registers the 3 TikHub prices (applied to dev);
  - unit 294, DB 413.
- ✅ **End-to-end adapter test** (`scripts/tikhub-live-test.ts`), 2 pages each:
  - X "toing" 32/32 and "Gears of War" 34/35;
  - TikTok "Gears of War" 40/40 ($0.002);
  - Instagram 0 recent, so it stays on API Direct.
- 🟡 Not yet observed in the scheduled pipeline with a real ledger row; both Demo products have scanning stopped. Check `api_cost_ledger where provider = 'tikhub'` after resuming.

## Fixes from founder testing (2026-10-19)

- ✅ **Scheduler on Vercel:** the Supabase Vault `app_url` had a stray `/$0`, so every 2-minute tick reached a page instead of `/api/jobs/tick`. Corrected; a direct call ran 12 jobs (9 succeeded).
- ✅ **Paid platforms couldn't be turned on:** the upsert also rewrote key columns that customers may not update (42501). It now updates, then inserts if no row exists. Covered by an e2e test.
- ✅ **App Store / Play links** pasted with the app title after the URL are accepted.
- ✅ **Times in the viewer's time zone** everywhere (`formatTime`, sf_tz cookie app-wide).
- ✅ **Renaming a product updates its keywords:** the old name and domain keywords follow the edit, and searches are re-planned (`e2e/products.spec.ts`). The Demo product renamed Erly → toing was corrected in place.
- ✅ **Live progress:** historical search refreshes itself while running; Last/Next scan count down without a reload.
- ✅ **Hacker News exact-word search** (`typoTolerance=false`): "toing" matched 9,660 near-miss posts in 7 days (doing, going…) vs 0 exact, so a 7-day history took ~30 min and found nothing.
- ✅ **AI decides "needs review" mentions** when ≥ 70% confident (`aiRelevanceDecision`), on the owner's decision 2026-10-19:
  - only `pending` changes; rule decisions and team decisions are never touched;
  - "unsure" waits for a person;
  - decided-relevant mentions count toward the allowance (billing trigger).
  - Applied to already-checked mentions: 127 relevant and 44 not relevant for toing. Buzz goes from 244 to 371.
- Why the three numbers differ:
  - **historical search "collected":** everything that run saved, before relevance;
  - **Mentions:** relevant + needs review, duplicates hidden;
  - **Buzz:** relevant only, with a real publication date (web results without a date are listed but not charted).
- ✅ **Workspaces on a non-public plan showed as Free:** `plans_read` exposed only public plans, so the Demo workspace (internal_unlimited) was limited in the UI as Free (e.g. competitors blocked). Migration `20261019000003` lets members read the plan their own workspace is on; other hidden plans stay hidden. DB tests: 410 pass. Applied to dev.
- ✅ **Feedback counts are clickable:** every Feedback Intelligence count opens Mentions filtered to the posts behind it (`?feedback=features` …).
- ✅ **Buzz graph:**
  - starts where monitoring started, instead of mostly grey unmonitored days;
  - draws straight lines, not smoothed curves;
  - shows no "possible spike" when there is no baseline yet.
- ✅ **Integrations** shows each source's relevant mentions in the last 30 days, with a link to them.
- Housekeeping: 11 leftover e2e workspaces (interrupted test runs) had scanning stopped; their data is kept.

## Authentication repair and social sign-in (2026-10-18)

**Reproduced first.**
- **Google:** Supabase answered `400 "Unsupported provider: provider is not enabled"`. The Google provider was never switched on in Supabase (no client ID/secret), and the button sent people straight to that raw error.
- **Email verification**, two problems:
  1. Supabase's Redirect URLs held only `https://signal-forge-phi-six.vercel.app/` (no `/**`) and the Site URL was `http://localhost:3000`, so a link requested from the deployed site was redirected to `localhost`. Reproduced with an admin-generated link: `303 → http://localhost:3000#…`.
  2. The email templates are Supabase's defaults (`{{ .ConfirmationURL }}`, PKCE `?code=`), but `/auth/confirm` accepted only `token_hash`, so even a correctly redirected link showed "That link isn't valid".

**Fixed.**
- ✅ `/auth/confirm` handles token-hash links, PKCE `code` links, and Supabase's `?error_code=` redirects:
  - expired or used → explained, with resend;
  - opened in another browser → "sign in to continue";
  - a second click while already signed in → carries on.
- ✅ `/auth/callback` maps provider errors to specific messages (cancelled / timed out / not available / email unverified / identity already used).
- ✅ Social sign-in uses one action for Google, GitHub and X (`provider: "x"`, OAuth 2.0). A button is shown only when Supabase reports the provider is on, so there are no broken buttons. No extra scopes (GitHub: `user:email` only; no repository access).
- ✅ Login and signup redesigned: provider buttons, "Or continue with email", live password requirements, resend verification (signup confirmation page, unconfirmed sign-in, expired-link notice), clearer errors.
- ✅ After sign-in, `/onboarding` routes unfinished accounts to the right step and finished ones to the dashboard.
- ✅ CSP `form-action` allows the GitHub and X sign-in pages.
- ✅ `npm run auth:check` (`scripts/auth-config-check.ts`) reports environment variables, providers, redirect-URL acceptance, templates and email sender. It prints no secrets.
- ✅ Supabase dev project, with the owner's approval via the Management API: Site URL → `https://signal-forge-phi-six.vercel.app`; Redirect URLs + `https://signal-forge-phi-six.vercel.app/**`, `http://localhost:3000/**`. Re-tested: the link now redirects to the Vercel site.
- Email templates were **not** changed: Supabase refuses template edits on free projects using the built-in sender ("configure a custom SMTP provider"). The app handles the default template.

**Tests.**
- ✅ Unit: `src/lib/auth/flow.test.ts`.
- ✅ Browser: `e2e/auth.spec.ts`, 11 tests:
  - provider visibility, OAuth callback errors, signup validation;
  - no duplicate account for an existing email;
  - verification, reuse and expiry; Supabase error redirects; other-browser codes;
  - unconfirmed sign-in + resend form;
  - password login, session persistence, logout;
  - existing account keeps its single workspace;
  - open-redirect refusal;
  - password reset end to end.
- ✅ Full regression: unit 284/284, DB 407/407, typecheck, lint, production build. All 17 browser spec files pass, 53 tests, run one file at a time because the Supabase auth rate limit (429) stops a single full run.
- ✅ 2026-10-19: Google and GitHub switched on in Supabase by the owner. Supabase hands off to accounts.google.com and github.com/login/oauth; `e2e/auth.spec.ts` 12/12, including the OAuth hand-off test. X is not being set up for now: the code stays, and the button stays hidden while the provider is off.
- ⬜ Not verified live: a real Google/GitHub/X login, a real verification email from the deployed site, a real reset email. See the live checklist in ENVIRONMENT_SETUP.md §2.

**Owner action.**
- ✅ Google and GitHub done (2026-10-19). X: not planned for now.
- Configure custom SMTP (built-in sender: 2 emails/hour, team addresses only), then optionally switch to the token-hash templates (§1).
- Set `NEXT_PUBLIC_SITE_URL=https://signal-forge-phi-six.vercel.app` in Vercel.

## Stop scan; founder test setup with paid sources and Gemini on (2026-10-18)

- **Stop scan / Resume scanning** on Smart Monitoring (workspace admins; migration `20261019000002`):
  - Stopping parks every search of the product and its competitors (`next_run_at = infinity`, so the scheduler never picks them) and ends a running historical search (unfinished platforms show "Stopped").
  - Jobs already queued check the flag and exit without calling any source. Interval recalculation leaves stopped products alone, and starting a historical search is refused while stopped.
  - Resuming makes every enabled search due at once. Collected data, keywords and settings are kept.
  - Tests: DB +7 (→ 407), browser `monitoring.spec.ts` "Stop scan…".
- **Founder test setup (development project only, by request):**
  - Non-public internal plan `internal_unlimited` (50 products, 50 keywords, 10M mentions/month, 730 days of history, 15 min floor, no price, never offered), granted to a new **Demo** workspace under the founder's login.
  - Spending caps chosen by the founder: API Direct $50/month (global + provider budget rows), Gemini $20/month (`ai_global_budget`, was $1).
  - `PAID_SOURCES_ENABLED=true` in `.env.local`. Automatic classification is on for the Demo workspace.
  - To undo: revoke the grant (`scripts/grant-internal-plan.ts --revoke`), lower or delete the budget rows, and set `PAID_SOURCES_ENABLED=false`.

## Product correction: keyword-first monitoring, Connect Claude, spike graph (2026-10-18)

Commits `7fbf7e5`, `381ed83`, `aad13f9`. Migration `20261019000001` (read-only function; applied to the development project after a dry run). No paid API or AI calls were made: browser tests use fixtures and the test classifier, and the dev server ran with the scheduler off.

**A — Smart Monitoring, keyword-first**
- Onboarding: company (workspace name), product name, website, description, category, keywords and historical period were already collected. The **product name is now always a monitored keyword**: added or switched back on when keywords are saved, and shown as "Always monitored" (can't be removed). An ambiguous name stays off until it has context words.
- First scan: searches never checked before run at once instead of waiting for their rotation turn, so every keyword × platform gets a baseline. Historical search already ran one task per search group (every keyword). Skipped keywords are listed with their reason, never silently.
- Rankings: `keyword_platform_counts` (relevant mentions per keyword × platform, caller's RLS). Keywords, each keyword's platforms, and the overall platforms are ranked **by mention count only** (ties by name). Growth is shown beside the rank and never changes it. A mention matching two keywords counts for each keyword but once in totals. Never-scanned platforms have no rank. States shown: not scanned / learning / partial coverage / monitored. The stored platform rank (diagnostics) is now the raw 28-day count, and checked "learning" platforms are ranked too.
- Prioritization: unchanged arrival-rate engine. Busier keyword × platform searches get shorter intervals; quiet ones are still checked at least daily; overflow safety, budgets and plan floors still apply.
- Page: summary (total mentions, active platforms, keywords monitored, last/next scan, coverage warnings), Keyword performance (expand for its platform ranking), Overall platform performance (mentions, share, growth, refresh, next scan, coverage). Formulas, the diagnostics table and the keyword schedule are under "Advanced details". Historical search, More platforms and Launch Boost are unchanged. Follows the global date range (24 h – 90 d or custom; the database compares at most 400 days).

**B — Claude**
- Settings → **Claude** (was "Developer agent"): one card with one state (Not connected / Connecting / Connected / Needs attention / Unavailable) and **Connect Claude**. Connected only after Claude actually calls SignalForge.
- Connect dialog: copy SignalForge's address → **Open Claude** (`claude.ai/customize/connectors`) → Add → custom connector → approve in SignalForge. Claude documents no link that pre-fills a connector, so pasting the address is a required manual step. The page re-checks while waiting.
- The MCP URL, Claude Code command and plan notes appear only under "Having trouble connecting?". Routine setup is collapsed under "Automatic investigations (optional)". GitHub is its own card ("Unavailable" while the GitHub App isn't configured — no setup instructions). Detailed states and per-connection revoke are under "Manage connection". **Disconnect** revokes every connection of the workspace.
- Investigation → approval → implementation unchanged and re-tested.

**C — Buzz spike graph**
- One "Mentions and spikes" graph replaces the stacked bar chart and the spike text list. Filters update the same graph: All activity / a platform / a keyword, and 24h · 7d · 30d · 90d · Custom.
- Confirmed spikes are filled triangles; possible spikes are hollow circles. Hover shows date, count, usual baseline, multiple, confidence and scope.
- Clicking a marker (or pressing Enter on it, or using the chip list) opens a side panel: baseline comparison, contributing platforms and keywords, the most engaged relevant mentions, and **Explain with AI** on request (existing Gemini pipeline, cited).
- Publication time on a real time axis. Unmonitored periods are shaded and not drawn as zero; partly monitored periods are shaded lighter. A short notice appears while the baseline is too short. Table view is available. Spike detection itself is unchanged.

**Checks**

| Check | Result |
|---|---|
| Unit tests | ✅ 277/277 (+9 ranking, +1 brand term, +1 connection state) |
| Database tests | ✅ 400/400 (+6: keyword counts, case-insensitivity, current keywords only, relevance filter, RLS, anon) |
| Typecheck, lint, production build | ✅ |
| Browser tests (changed areas) | ✅ monitoring 5/5, agent 2/2, buzz 6/6, discovery + AI 6/6 in targeted runs |
| Full browser run | ✅ 41/41 passed, 1 skipped (live Gemini, opt-in). The full run passed 21; the other 20 were refused at sign-in by Supabase Auth's verify rate limit (429 / `link_expired`) before reaching any page, and all 20 passed when re-run in batches after the limit reset (monitoring 5, reports 2, mentions 6, Stripe webhook 1, email 1, discovery 4, insights 1, members 2). |

## Email (Resend) — built, not yet sent for real (2026-10-18)

Migration `20261018000007`.
- `sendEmail` posts to Resend's REST API (idempotency key per email) when `RESEND_API_KEY` and `EMAIL_FROM` are set; otherwise it records "skipped". Every attempt is logged in `email_log` (kind, recipient, subject, status, provider id — no bodies; service role only; purged after 90 days). Never throws: email is best effort.
- **Invitations** are emailed on creation (the copyable link stays as a fallback).
- **Weekly reports** are emailed after daily maintenance generates them, to members who haven't turned them off (`notification_preferences.weekly_report`, default on), once per person per report.
- **Unsubscribe**: signed, non-expiring per-person/per-workspace links (HMAC key derived from the credentials key) in the footer and in `List-Unsubscribe` + `List-Unsubscribe-Post` headers (one-click, RFC 8058). GET only shows a confirmation button (mail scanners open links); POST unsubscribes. Settings → Account has the toggle.
- Templates escape all user and post-derived text, keep subjects single-line, and include plain-text parts.
- Tests: unit `email.test.ts` (3); DB +2 (→ 393); browser `e2e/email.spec.ts`.
- **Not verified**: real delivery needs a Resend key and a verified sending domain.

## Stripe billing — built for test mode, not yet run against Stripe (2026-10-18)

Migration `20261018000006`; `stripe@22.6.2` (pinned; API 2026-08-26.dahlia).
- **Checkout** (workspace owners): Stripe Checkout in subscription mode for a public plan with a `stripe_price_id`; the workspace's Stripe customer is created once (idempotency key) and linked; workspace id in `client_reference_id` and subscription metadata. A workspace with an active Stripe subscription changes plans in the **billing portal** (plan switching between SignalForge prices, card updates, invoices, cancel at period end).
- **Webhook** `/api/stripe/webhook` (outside the session proxy): signature verified over the raw body (5-minute tolerance) — nothing else is trusted; idempotent per event id (`billing_events`); subscriptions written only by `svc_apply_subscription` (service role), which applies events in Stripe's order (late events ignored), refuses unknown prices, mixed-plan subscriptions and other subscriptions overwriting the active one, and returns deleted subscriptions to Free (data kept). Billing period from the subscription item (current API) with a fallback for older shapes. Past due keeps the plan while Stripe retries; the owner sees a banner with "Update payment method".
- `scripts/stripe-setup.ts`: dry run by default; `--apply` creates/reuses one Product + monthly Price per paid public plan from the plans table (lookup keys), records the Price ids, and creates a tagged billing portal configuration. Refuses live keys without `--live`.
- Tests: unit `stripe-map.test.ts` (4); DB +8 (→ 391); browser `e2e/stripe-webhook.spec.ts` (events signed exactly like Stripe's with a development-only secret: forged signature refused, applied, duplicate, stale, past-due banner, unknown price, deleted → Free, unhandled ignored); `billing.spec.ts` updated.
- **Not verified**: Checkout, portal and real webhook delivery need Stripe test keys (`STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_WEBHOOK_SECRET` from the endpoint or `stripe listen`).

## Connected sources: Google Play and Discord; App Store, Bluesky and DEV verified (2026-10-18)

- **Verified live**: Apple App Store reviews (public feed: all 50 entries of a live app normalized), Bluesky and DEV (collected real mentions on 2026-10-17). Catalog now says "available".
- **Google Play** (`src/lib/sources/google-play.ts`, *unverified — no Play Console to test with*): official Play Developer API `reviews.list` with a service account the customer creates and invites in Play Console ("View app information"); RS256 JWT bearer grant, read-only `androidpublisher` scope; one workspace connection, per-product package from the product's Play URL. Connecting checks the key locally, signs in to Google and (if a product has a Play URL) reads one review to prove access; the key is stored encrypted and never shown again. Google only returns reviews from about the last week.
- **Discord** (`src/lib/sources/discord.ts`, *unverified — needs a Discord application*): SignalForge's bot, installed by a server admin through Discord's OAuth2 bot flow with **View Channels + Read Message History only** (permissions 66560). The callback trusts only the server returned by the **code exchange** (a guild id in the URL is ignored), bound to the user/workspace/product by signed state. Admins choose channels and mode ("every message" — counts toward the allowance — or "only keyword matches"). Bots, webhooks and system messages are skipped; messages link to themselves; replies keep their parent. If every message comes back without text, the run fails with "turn on the Message Content intent" instead of storing blanks. Searches only start once channels are chosen.
- Connected sources are planned like product-level streams (`play:<package>`, `discord:<product>`); the monitor decrypts the connection only at fetch time. Disconnecting deletes the stored secret and stops the searches.
- Tests: unit `connected.test.ts` (key validation, JWT signature verified with the public key, token exchange + paging, window filtering, error messages, Discord paging from the window's snowflake, skips, intent detection, planning); browser `e2e/connections.spec.ts` (bad keys refused and never stored; Discord channel state; no search without channels).
- Known: in the full browser run (8.8 min, dev scheduler ticking in the background) two long tests timed out once and passed on re-run.

## Staff cost dashboard (2026-10-18)

- `/admin/costs` for SignalForge staff only: verified accounts listed in `SIGNALFORGE_STAFF_EMAILS`; everyone else gets a 404 (title included). Read-only; limits are still changed by the operator.
- One service-role-only SQL summary (`svc_admin_cost_summary`, migration `20261018000004`): Gemini spend this month against `ai_global_budget` (by purpose, model, day; failures; in-flight reservations counted like the budget check), API Direct spend against the global/provider limits (by platform, day), per-workspace AI and paid-data spend plus mention allowance use.
- **Fix (migration `20261018000005`)**: AI usage records used to be deleted with their workspace, which removed already-spent money from the month's total that the Gemini limit is checked against. They are now kept (detached). The ~$0.003 of live-test spend deleted before the fix can't be recovered.
- Tests: DB +3 (→ 383); browser `e2e/admin-costs.spec.ts` (customer 404, staff view). Development `.env.local` lists the founder's account and `sf-e2e-staff@example.com`.

## Member invitations and member management (2026-10-18)

Migration `20261018000003`.
- **Invitations**: a link for one email address and role, valid 7 days, single use; re-inviting the same address replaces the open link. Only the SHA-256 hash of the token is stored (the token is generated server-side and shown to the inviter once); hashes aren't readable through the API. Admins invite members/viewers/admins — **only owners invite admins**; nobody is invited as owner; existing members aren't re-invited.
- **Accepting** (`/invite/[token]`) requires being signed in with the invited address; other accounts see whom it's for and can switch. Expired / used / revoked links say so. Signed-out visitors go through sign-in or sign-up and come back (sign-up now carries `next` through the confirmation email).
- **Members**: owners manage everyone (including making owners); admins manage members and viewers; anyone can leave; the last owner can't leave or be demoted (existing trigger).
- No seat limit: plans don't define one, and pricing/limits weren't changed — a decision for the founder.
- Email delivery of invitations waits for Resend (M6); for now the inviter copies the link.
- Tests: DB +25 (→ 380); browser `e2e/members.spec.ts` (invite → wrong account blocked → accept → single use → viewer has no invite tools → role change → remove → revoke; sign up from an invitation link).

## Reports (2026-10-18)

- **Weekly reports**, made in the scheduler's daily maintenance for the last complete UTC week (Monday–Sunday) for every active product that doesn't have one; nothing is stored when nothing was monitored. **Last 7 days** reports on demand (members). No API or AI calls: every number comes from the same SQL as the dashboards (`buzz_totals`, `buzz_coverage`, `buzz_series`, `feedback_daily`, issues with posts in the period, spikes, competitor share of voice, most engaged posts), compared with the previous period. Week-over-week change is only stated when monitoring covered at least half of both periods.
- Highlights are fixed rules over those numbers (volume and change, top platform, negativity shift, high-priority and new issues, confirmed spikes, share of voice, coverage warning) — not AI.
- `/reports` list, `/reports/[id]` view (print / save as PDF: app chrome is hidden in print), `/reports/[id]/csv` download (RLS, UTF-8 BOM, formula injection neutralised).
- Tests: unit `weekly.test.ts` (week bounds, change rules, highlights, CSV escaping); browser `e2e/reports.spec.ts` (no report from nothing; numbers match fixtures exactly; CSV).
- Not yet: emailing reports (needs Resend), optional AI narrative.

## Product Insights — M5 re-scoped (2026-10-18)

Code-level investigation moved to the customer's own Claude in 4B (developer agent), so M5 covers the evidence side. Migration `20261018000002` (investigation kinds).
- `/insights`: open issues by priority with which analyses exist, recent analyses, developer-agent tasks. `/insights/[issue]`: all posts, priority evidence (observed vs inferred), status actions and:
  - **Summary** (existing cited summary).
  - **Feature evaluation** (feature requests): cited needs / use cases / workarounds / concerns + AI-suggested open questions; **demand strength is computed from measured facts** (independent people, platforms, recurrence, trend — `demandStrength`), never asked of the model. Many posts from few people stay "early".
  - **Already on GitHub?**: GitHub issue search in the product's repository (public repositories; read-only, no AI). Words: area, stored terms, words recurring in ≥ 2 of the issue's posts; product name excluded; PRs dropped; results labelled "likely the same" (≥ 2 shared words covering half the search words) or "possibly related" — never asserted as duplicates. Private/missing repos say so.
  - **GitHub issue draft**: the model writes cited statements only; title sanitized, body (sections, numbered sources, measured reach) assembled by code; markdown/HTML control characters and @mentions neutralised. The user edits it and opens GitHub's own new-issue page prefilled (`newIssueUrl`); **SignalForge never creates issues or writes to repositories**.
  - Developer agent controls (4B).
- AI calls go through the same budget/cache/validation path (purposes `feature_evaluation`, `issue_draft`); test classifier outputs for both.
- Shared issue UI extracted to `src/components/feedback/issue-parts.tsx` (Feedback page refactored to use it).
- Dev-only GitHub search stand-in `/api/dev/mock-github` for reserved `e2e-fixture/*` repositories (404 in production), so browser tests never call GitHub.
- Tests: unit `insights.test.ts` (demand, issue body, URL, search terms, ranking); browser `e2e/insights.spec.ts`. Not verified live: GitHub search against a real repository (uses `GITHUB_TOKEN` when set), real Gemini output for the new prompts.

## Fixes after 4A/4B + Competitors (2026-10-17/18)

**Fixes (commit 20e2ee9).** Live Gemini verified (schema keywords Gemini rejects are stripped; one embedding per text; 402 prepaid-credit errors stop instead of retrying; live run cost $0.0026, `e2e/ai-live.spec.ts`, opt-in with `LIVE_GEMINI=1`). The dev server now ticks the scheduler itself (`src/instrumentation.ts`; `DEV_SCHEDULER=off`); the manual "Scan now" button was removed. RLS policies compute membership once per query (`20261017000004`): reading 13k mentions went from 1.8 s to 23 ms, Buzz no longer hits the statement timeout. Monitoring stops follow-up loops and checks 6-hourly while the mention allowance is used up.

**Competitors (migration `20261018000001`).**
- Each competitor gets a hidden *tracking product* (`products.competitor_of`), so collection, dedup, relevance rules, AI classification and the Buzz SQL functions work unchanged and the product's own data is untouched. Tracking products are excluded from product lists, the product limit and the product keyword allowance; each has at most 3 keywords (name + 2). Their mentions count toward the mention allowance. Issue grouping is skipped for them (no embedding spend on issues nobody sees).
- Writes only through `add_competitor` / `update_competitor` / `remove_competitor` (admins); plan limit `max_competitors_per_product` (Free 0, Pro 3, Scale 5). Pausing archives the tracking product (its searches are disabled); removing deletes it and its mentions. Archiving a product archives its competitors' tracking.
- `/competitors`: share of voice, daily volume and sentiment, computed **only on sources monitored for the product and every competitor**, over the period **all of them were tracked** (both disclosed on the page). Sentiment needs ≥ 20 classified mentions before a net score is shown; classification coverage is shown.
- Colors: new `--entity-1…6` tokens (reference categorical slots, validated with the dataviz validator in light and dark: adjacent CVD ΔE ≥ 8.4, normal-vision ≥ 19.3; light slots 3–5 below 3:1 → legend, labels and table view). The existing `--chart-*` platform palette fails the validator in dark mode (too light; two adjacent hues ΔE 14.9) and `--chart-6` is under the chroma floor — follow-up.
- Tests: unit (`competitors.test.ts`, 5), DB (+18 → 355), browser (`e2e/competitors.spec.ts`: free plan blocked; add → searches → share of voice/volume/sentiment on common sources → pause → remove).
- Not yet: historical search for competitors (comparisons start when a competitor is added).

## Milestone 4A/4B — two AI systems: SignalForge Intelligence (Gemini) and Claude developer agent (2026-10-17)

This corrects the first Milestone 4 architecture (section below).
- **SignalForge Intelligence** is SignalForge's own Gemini-based AI. Customers no longer connect an AI provider. Previously saved customer keys stay encrypted and can be removed in settings.
- **Developer agent** is a separate system that uses the customer's own Claude.

**What has not run live:** no paid model, Claude routine or GitHub App call was made. Gemini is not enabled (`SIGNALFORGE_AI_ENABLED=false`, no key, no `ai_global_budget` row). Anthropic and Google capabilities were checked against their official documentation on 2026-10-17 (API_LIMITATIONS.md).

**Migrations** (both on dev project `qwcsglwwxljyyjqsppiz`, verified against `.env.local`; each applied after a dry run via `scripts/supabase-cli.sh`):
- `20261017000002_intelligence_and_developer_agent` (additive);
- `20261017000003_dev_routine_url` (additive; lets the dev routine stand-in URL be stored).

### 4A — SignalForge Intelligence
- **Gemini adapter:** official `@google/genai` SDK. Models are configurable; a model without a known price is refused. Answers are JSON-schema requests, validated again with Zod. The key is sent in a header, never in the URL.
- **Classification:**
  - relevance (shadow mode), sentiment toward the product, 8 categories, feedback signals, severity, affected area and confidence;
  - product context: website, category, aliases, competitors, keywords;
  - batched and cached, and non-blocking (queued jobs).
- **Semantic grouping:**
  - 256-dimension Gemini embeddings, joined at cosine ≥ 0.86;
  - borderline groups (0.74–0.86) merge only on a cheap-model "yes";
  - merge checks are cached, at most 40 pairs and at most one round per product every 6 hours;
  - word-based fallback when embeddings aren't available.
- **Priority:** combines severity, independent reporters (log scale), trend, recurrence and confidence. Each issue shows its observed and inferred evidence.
- **Feedback page:**
  - numbers: actionable issues, bug reports, feature requests, complaints and positive feedback;
  - charts: sentiment over time and bugs/features/complaints over time, with colors checked for colour-vision deficiency and table views;
  - breakdowns: category, platform and priority distributions;
  - trending and newly emerging issues.
  - Unclassified mentions are shown separately.
- **Spike explanations:** product, platform and keyword spikes, with measured platform, sentiment and issue facts shown next to the cited AI text.
- **Shadow-mode evaluation:** precision, recall, false positives and negatives, and unsure answers, compared with manual labels (Settings → SignalForge Intelligence). Billing is unchanged.
- **Spending controls:** reserve → settle for every call, embeddings included. Calls need the plan allowance and the operator's global limit. Test-classifier calls are tagged `test` and never count against either.

### 4B — Claude developer agent
- **Remote MCP server** (`/api/mcp`, stateless): 7 read tools and 3 agent tools. Every query is filtered by the token's workspace, results are bounded and paginated, and public posts are labelled untrusted.
- **OAuth 2.1:**
  - client registration, S256 PKCE and single-use codes (reuse revokes the grant);
  - rotating refresh tokens (reuse revokes the grant), RFC 7009 revocation and in-app revocation;
  - workspace membership is re-checked on every request; only token hashes are stored;
  - Claude-only callbacks; consent page with a workspace choice.
- **Settings → Developer agent:**
  - accurate status: Not connected / Setup required / Repository access required / Coding-agent execution unavailable / Ready / Error;
  - connector URL, revocation, GitHub App install and repository choice, routine setup (prompt plus encrypted token), task history.
- **GitHub App:** read-only; installation ownership verified with the install-time user token. Implemented and unit-tested; no App is registered yet.
- **Workflow:**
  - "Investigate with Claude": a routine run needs an explicit acknowledgement; without a routine you get a manual handoff to paste into Claude Code.
  - The agent fetches its task over MCP and submits a structured report.
  - An admin approves the exact plan hash (single use; bound to workspace, issue, repository and environment), then implementation starts.
  - The PR is reported over MCP and checked with the GitHub App when configured; otherwise it shows "unverified".
  - Cancellation, a 6-hour timeout, and pull requests opened during an investigation flagged.
- **Investigation is not technically read-only.** Routines run with the customer's full Claude Code permissions, so "no code changes" is an instruction. The product, the docs and the MCP output say so (`code_changes_allowed: false` is an instruction, not enforcement).

### Checks
| Check | Result |
|---|---|
| `npm run test:unit` | ✅ 239/239 (rewritten AI and Gemini adapter tests; new agent tests) |
| `npm run test:db` | ✅ 337/337 (27 new) |
| Browser tests | ✅ 25/25 |
| typecheck, lint, `npm run build` | ✅ |

New unit tests (Gemini over a fake transport, no network):
- AI: structured requests, invalid output, refusals, HTTP errors, embeddings, classification fixtures, semantic grouping, priority ranking, shadow evaluation, pricing, availability.
- Agent: OAuth redirect rules, PKCE (RFC 7636 vector), registration validation, discovery metadata, signed state, task states, approval scope and single use, report and PR validation, context bounds, routine trigger and errors, GitHub App JWT, installation verification, PR state and PRs opened during an investigation.

New database tests: test billing tag, plan-budget refusal, settle v2, the feedback series under row-level security, token hashes only, OAuth tables hidden, grants admin-only, agent tables read-only for users, routine URL and secret columns hidden, a single active approval, and cross-workspace isolation.

Browser tests:
- `e2e/ai.spec.ts`: classification, semantic issue, priority evidence, analytics, shadow evaluation, summary, and product plus keyword spike explanations.
- `e2e/agent.spec.ts`:
  - main flow: client registration → consent → PKCE token → MCP tools; workspace isolation; repository; routine through the dev stand-in; acknowledgement; investigation → report → approval → implementation → PR;
  - also covers wrong-repository PR refused, cancellation, refresh rotation, revocation, and code reuse revoking the grant;
  - plus OAuth denial and refused foreign redirects.

The first full browser run had 23/25. Two tests hit the Supabase Auth rate limit (`link_expired`): one passed on re-run, the other then exposed a locator bug in my test, which I fixed before it passed.

## Milestone 4 — AI intelligence (2026-10-17) — superseded by 4A/4B above

Built and tested against fake providers and the development-only test classifier. **No model was called** (no AI key is configured; SignalForge AI credits need the founder's approval, a global budget row and `AI_SIGNALFORGE_ENABLED=true`). Migration `20261017000001_ai_intelligence` (additive) applied to the dev project (`qwcsglwwxljyyjqsppiz`, checked against `.env.local`) after a dry run that listed only this file, via `scripts/supabase-cli.sh` (token-based CLI auth without the macOS Keychain; credentials in `~/.config/signalforge/supabase.env`, mode 600, outside the repo).

### What was built
- **Providers:** Anthropic via the official SDK (`@anthropic-ai/sdk`): classification on `claude-haiku-5-5` (low effort, thinking off), on-demand analysis on `claude-opus-5-5` (medium effort, server-side refusal fallback). OpenAI and Gemini are BYOK only, over HTTPS, using the model the customer names. Every output is validated with the same Zod schema.
- **BYOK validation:** a token-free model-list call on save and via "Verify". A rejected key is marked invalid; a network failure leaves it unverified. For OpenAI/Gemini the chosen model must be available to the key. A key rejected later during use stops AI work for the workspace.
- **Budgets:** every call is reserved before it is made (`svc_ai_reserve`) and settled with actual usage (`svc_ai_settle`), or released if the provider was never reached.
  - SignalForge credits need the plan's monthly token budget **and** an operator global USD budget (`ai_global_budget`; no row = nothing spent).
  - BYOK has an optional monthly token cap.
  - Abandoned reservations expire after an hour.
- **Cache:** outputs keyed by content hash, product context, model and prompt version, per workspace (never shared).
- **Staged pipeline:** rules → dedup (only originals) → cheap classifier (batched ≤20 posts) → deterministic clustering → deep analysis only when a user asks.
- **Classification:**
  - sentiment toward the product, not the post's mood;
  - one of the 10 feedback categories;
  - an advisory "about the product?" hint with a reason.
  - Labels below 0.5 confidence show as uncertain or uncategorised.
  - Manual corrections are never overwritten.
  - AI never changes `relevance_status`, the mention allowance or analytics tables.
- **Issues (Feedback page):** TF-IDF grouping per category, with product names excluded. An issue needs two or more independent reports (reposts, duplicates and repeat authors count once). Each issue shows its supporting posts, platforms, first/last dates, suggested priority and confidence. Team status (acknowledged/resolved/dismissed) survives re-clustering.
- **Explanations:** spike explanations (Buzz) and issue summaries (Feedback) cite posts. Statements without valid citations are discarded. With fewer than 3 usable posts, the result is "insufficient data" and no model call is made. A failure marks only that analysis as failed.
- **Prompt-injection hardening:** posts are passed as escaped JSON inside data blocks, with local ids (m1…/e1…) and no tools. Labels come from fixed lists, links are removed from model text, and output is rendered as plain text.
- **Fixed during browser testing:** "Explain this spike" rejected spikes covering all platforms (they send an empty platform value).
- **Known UX gap:** a second "Explain" click while the page is refreshing from the first can be dropped. It only needs another click.
- **UI:**
  - AI settings: status, verify, provider choice, model field, usage by purpose, auto-classify, BYOK cap, dev-only test classifier.
  - Feedback page: classification status, "Classify now", sentiment toward the product, issues with evidence, "Summarize with AI".
  - Mentions: AI or test labels.
  - Buzz: "Explain this spike".
  - Realtime `ai` events refresh open pages.

### Checks
| Check | Result |
|---|---|
| `npm run test:unit` | ✅ 216/216 (adds 12 AI pipeline + 5 provider-adapter tests with a fake fetch) |
| `npm run test:db` | ✅ 310/310 (adds 26: budget reservation and settlement, global and plan limits, unknown price, BYOK cap, stale reservations, RLS on settings/cache/budget/usage/analyses, no forged classifications or AI fields) |
| typecheck, lint, `npm run build` | ✅ |
| `e2e/ai.spec.ts` (2 tests) | ✅ 2/2 against the dev project. Covers test-classifier labels, issues with evidence (a repeat author counts once), a cited summary, team status, a cited spike explanation, and "insufficient data" with no model call; relevance and the allowance are untouched; usage is reserved and settled |
| Full browser suite | ✅ 23/23 (21 on the first run; 2 hit the Supabase Auth rate limit (429 / expired link) and passed on re-run) |
| Live model calls | ⬜ none made (no key; needs authorization) |

## Discovery Engine V2 — pagination, adaptive monitoring, historical search, spikes, realtime (2026-10-16)

Follow-up work committed first as `a12e21c` ("feat: internal testing grants and keyword cost simulations"; no secrets staged — none of the `.env.local` values occur in the diff). Migrations `20261016000007_discovery_engine_v2` and `20261016000008_coverage_partial_wins` (both additive / function replacements; no data changed) applied to the dev project after dry runs. No paid API calls (`PAID_SOURCES_ENABLED=false`); no budgets, prices or allowances changed.

### Checks
| Check | Result |
|---|---|
| `npm run test:unit` | ✅ 199/199 (adds 45: arrival-rate estimation and forgetting, saturated-check exposure, quantiles, hour-of-day profile, brand-safe interval, page right-sizing and escalation, right-sized cost, product-relative ranking (200 vs 3,000 mentions), rate-scaled intervals, importance tilt, brand-safe pacing incl. "unavoidable", budget pacing never past the safe interval, quiet-platform exploration, learning phase, no risk from the prior alone, stability/hysteresis, resumable gaps (range, whole-day, page, none, stall), collection profiles, provider history depth, backfill planning and run status, history date selection and validation, broad-keyword warnings, spike math and confidence (confirmed / possible / insufficient data, low/high volume, seasonality, unmonitored and partial periods, backfill-safe, fallback "possible", product-level completeness)) |
| `npm run test:db` | ✅ 284/284 (adds 26: workspace events coalesced, size-limited, kind-checked, member-only, unforgeable, other workspaces see none; backfill runs/tasks, arrival estimates, keyword spikes and spike evaluations member-read-only and isolated; `keyword_series` respects RLS; service RPCs not callable by members; backfill scheduling enqueues once, skips sources not running, pauses at an exhausted allowance until renewal and keeps the cursor; partial coverage wins over complete) |
| `npm run test:e2e` | ✅ 21/21 (adds 4 and updates 2; run in two batches because Supabase Auth rate-limited test sign-ups (HTTP 429) — no assertion failures): realtime update of page 1 without reload (after the first-connect catch-up, so only the event can explain it); "1 new mention found — View latest" on page 2 with filters kept; **Realtime workspace isolation** (a second user subscribing to the first workspace's events receives nothing while each owner receives theirs); historical progress states without percentages, live update of progress; product-relative share and overflow risk in Smart Monitoring; confirmed/possible/keyword spikes and "insufficient data" on Buzz; onboarding history step (default 30 days with exact dates, launch date required, plan window enforced) |
| typecheck, lint, `npm run build` | ✅ |
| Visual | Historical search step and progress, Smart Monitoring history card and form with a broad-keyword warning, at desktop and 375 px (no horizontal scroll, no console errors); throwaway account deleted |

### Verified live on free sources (dev project, throwaway Free workspace "Excalidraw", deleted afterwards)
- ✅ Scheduler ticks ran the V2 monitor on HN / GitHub / Stack Overflow / Bluesky / DEV for the dev products and the throwaway one: arrival estimates written per query group, `platform_activity` rows on `arrival_v2` (learning until 3 checks and 48 h of exposure), events emitted per finished job.
- ✅ A 7-day historical search: HN and Stack Overflow completed; GitHub returned 453 results, stored 20 and **paused at the Free plan's 100-mention allowance** (354 held, cursor kept for renewal); run status "paused" with the reason.
- ⚠️ YouTube returned **403 "access denied"** on every check (also at 11:07 UTC, before these changes) — the configured key is rejected (possibly rotated or the Data API not enabled). Not fixable from here.
- Found and fixed during the live run: prior-only rates/risk shown for never-checked searches (now none), legacy sources not reporting pages requested (now exact), a self-paused run without a reason (now recorded), spike evaluation limited to products with mentions in the last 2 h (now also any monitored product not evaluated in a day).

### Spike audit (Starlink: "Starlink", "SpaceX", "Elon Musk")
- **Why no spikes were stored before:** (1) the hourly detector only ran inside scheduler ticks, and none ran between Starlink's creation (09:35 UTC) and the audit; (2) it only stored periods from the last 48 h (daily) / 6 h (hourly), so **history added by the 30-day initial scan was never evaluated**; (3) write errors were silently ignored; (4) baselines used fixed minimums (≥ 8 mentions, ≥ 2.5×).
- **What the data supports:** the 30-day initial scan was **cut off** on Hacker News, GitHub and Bluesky (newest results only), but coverage was recorded per platform, so a complete window from another keyword's search marked those days "complete" — the rise from ~8/day to 102 on Oct 14 is at least partly a truncation artifact. Migration 008 makes any partial window win over a complete one.
- **Result with V2:** no **confirmed** spike can be claimed for Starlink (no completely monitored baseline: status "insufficient data"); 7 **possible** spikes are listed (product Oct 10, 14, 15, 16; Hacker News Oct 14–16) with the note that earlier periods were only partly monitored. octolens: "possible" spikes for its Starlink keyword on Oct 16. A historical search with continuation (now available) is what can turn these into confirmed or rejected.

### Remaining limitations (this work)
- Arrival estimates start empty: every platform is "learning" for its first 3 checks / 48 h of searched time, with bounded intervals.
- Coverage is still recorded per platform; partial wins over complete, so a cut-off search makes the whole platform's period a lower bound (conservative).
- An unread gap is not recorded as coverage until a continuation reads it; until then other keywords' complete windows can mark that time complete (transient).
- Whole-day date filters (X, Facebook) can't split inside a day; the unreachable part of a day is recorded as lost.
- Realtime needs the `workspace_events` table in the `supabase_realtime` publication (done by migration 007 on Supabase); events are signals only, the page refetches through RLS. First connect triggers one catch-up refresh; disconnected clients poll every 60 s while visible.
- Keyword-level spike completeness uses the product's completeness (keywords aren't tied to coverage windows).
- The simulation's volumes, relevance shares and ranked-search recall (70 %) are assumptions.

## Follow-up — security checks, internal Pro grants, effective keyword intervals, budget simulation (2026-10-16)

Subscription work committed as `b760d5f`. Migration `20261016000006_internal_plan_grants` (additive) applied after a dry run.

- ✅ **Credentials:** none of the 7 secret values in `.env.local` (GitHub, Stack Exchange, YouTube, API Direct, Supabase secret, encryption key, tick secret) occur in the staged diff, in any commit on any ref (`git log -p --all`), in unreachable objects or stashes; there is no git remote. The keys pasted into `.env.example` were moved to `.env.local` before any `git add`. **Rotation must be done by the owner** in each provider's console (not possible from here).
- ✅ **Internal Pro testing entitlements** (not subscriptions) for workspaces `signalforge` and `Starlink` via `scripts/grant-internal-plan.ts`; their `subscriptions` rows stay Free/provider none (the only two subscriptions in the database). Both products re-planned: all keywords searched again (octolens: starlink + wisprflow, 10 groups; Starlink: 3 keywords, 16 groups). `PAID_SOURCES_ENABLED=false`, no global paid budget — paid monitoring stays off.
- ✅ **Dashboard shows effective keyword intervals:** the keyword card now uses each search's scheduled interval (platform interval × rotation turns) and marks estimates "(est.)" until a search is scheduled; the ranking table shows "keywords every …" under the platform interval when they differ, and the details panel repeats it with any target conflict. E2E: Stack Overflow at 24 h with a 2-turn rotation shows "keywords every 2 days" and the conflict.
- ✅ **Budget simulation** (`scripts/simulate-plan-costs.ts`, no API calls): results and decision in COST_MODEL.md. Internal budgets **not raised** (Pro $25, Scale $75).
- Checks: unit 154/154, DB 258/258 (adds internal grants: Pro limits without a subscription, applies to monitoring, readable not writable by members, isolated, revocable), e2e 17/17, typecheck, lint, build ✅.

## Refinement — subscription restructure, mention allowances, API Direct live validation (2026-10-16)

Monitoring refinements committed first (`f01b957`). Migration `20261016000005_plans_and_mention_billing` (additive) applied to the linked project after a dry run.

### Checks
| Check | Result |
|---|---|
| `npm run test:unit` | ✅ 153/153 (adds: plan keyword refresh targets met by shortening within floors, unreachable targets reported with real intervals, rotation never over budget, keyword allowance shared by products in creation order with paused extras, 40 keywords all planned, paid pacing costliest-first with "doesn't fit" reported, 80/90/100 % levels, keyword limit messages, onboarding suggestions fitted to the allowance, plan rows, LinkedIn activity-id time from the live-observed shape) |
| `npm run test:db` | ✅ 251/251 (adds: Free $0 / Pro $100 / Scale $300 public, retired plans hidden; 1-keyword Free limit on save and on enable; billable = relevant originals, reposts/duplicates/re-seen/needs-review/excluded never counted; usage period = subscription period; 100 %: held not stored, exhaustion time, re-found held item not double-counted; paid queries not scheduled while exhausted; held items unreadable by users; usage readable, not writable; relevance refund within the period; admin release into the remaining allowance; no billing after exhaustion on promotion; earlier periods untouched; upgrade/downgrade; period boundaries incl. Jan 31 → Feb 28 → Mar 31 and the renewal instant; **two real connections ingesting concurrently never exceed the allowance**) |
| `npm run test:e2e` | ✅ 16/16 (adds billing: plan cards and prices, no old plans, checkout "coming soon"; usage at 80 % / 90 % / 100 % with held mentions; upgrade raises the allowance; Free keyword allowance in the editor; onboarding suggestions beyond the allowance start off) |
| typecheck, lint, `npm run build` | ✅ |
| Visual | `/settings/billing` desktop and 375 px (no horizontal scroll), warning banner, Smart Monitoring target text (throwaway account, deleted) |

### Subscription changes
- Plans (rows in `plans`, read by the UI): **Free $0** (1 keyword, 100 mentions, daily, 7-day keyword target, no paid platforms), **Pro $100** (10 keywords, 15,000 mentions, hourly floor, 24 h target, $25 internal paid budget), **Scale $300** (40 keywords, 50,000 mentions, hourly floor, 6 h target, $75 budget, 4 searches/check without OR, scheduler priority). Starter ($9) and Business ($49) retired (hidden; rows kept). No annual billing, no checkout ("coming soon"), no Stripe objects created.
- Keyword allowance per workspace, enforced by a trigger and in the editor; over-allowance keywords after a downgrade are paused (kept, shown, not searched).
- Billing periods follow `subscriptions.current_period_start/end` (new subscriptions start at signup; existing dev subscriptions keep their stored Oct 1 – Nov 1 period).

### Mention allowance (interim policy until M4 AI relevance)
- Counted: a new, unique stored mention that is an original (not a repost or exact duplicate) with rule status "relevant", or one the team marks relevant. Not counted: duplicates, reposts, re-seen items, "needs review", excluded items, empty searches, failed requests. Marking a counted mention "Not relevant" refunds it in the current period only. Metering started when the migration ran (no retroactive counting).
- 80 % warning, 90 % stronger warning, 100 %: further billable mentions are **held** in a bounded overflow queue (≤1,000 per workspace per period, 30 days after the period), paid platforms pause until renewal, free ones slow to daily; nothing is deleted, nothing charged, no automatic upgrade. Admins can deliver held mentions into remaining allowance (e.g. after an upgrade).

### API Direct live validation (authorized cap $0.05)
- Prerequisites: key in `.env.local` only (the pasted keys were moved out of the tracked `.env.example` before committing), provider spending limit confirmed by the founder, `PAID_SOURCES_ENABLED=false`, no global paid budget row, every request reserved in `api_cost_ledger`.
- ✅ 9 requests, all 200, 174 results, **$0.048 by documented billing rules** (9 settled ledger rows); remaining $0.002. Provider-confirmed charge not checked (no billing API). Not run: Google News, Trustpilot, the separate one-keyword OR comparison.
- ✅ Reddit global comment search works on comment text (45/45; parent titles without the keyword in ≥3 threads); ⚠️ no comment id/parent id/permalink in responses — links can't point at the comment.
- ✅ X search returns keyword-matching replies (12) and quotes (3) with status URLs; dates exactly UTC.
- ⚠️→✅ **LinkedIn dates were UTC+2** (20/20): fixed — time now from the activity id.
- ✅ OR accepted on Reddit/X/LinkedIn/web; ⚠️ one page is dominated by the high-volume term; complete recall not established.
- TikTok page size assumption corrected (28/page observed); Instagram relevance-ranked back to 2024 (always partial, as documented); web results have no dates (as documented).

### Dev data
- Both dev workspaces are on Free and exceed its 1-keyword allowance (octolens: "starlink", "wisprflow"; Starlink: 3 keywords). Keywords were **not changed**; re-planned so only the allowed keyword ("starlink" / "Starlink") is searched and the others show as paused. Unrelated test keywords (starlink, wisprflow) also distort the product's Buzz/virality analytics. YouTube now has a key configured but hasn't been live-verified by a scheduled check yet.

### Remaining limitations
- Bluesky: ≤300 posts per keyword per check; busier windows leave a permanent gap (documented; no Jetstream).
- Reddit comment permalinks unavailable from API Direct; Google News and Trustpilot not live-tested; provider-side charges not reconciled.
- With 10+ keywords on Pro, the $25 budget (not the 1 h floor) sets non-OR paid platform freshness; target conflicts are shown (COST_MODEL.md).
- Paid monitoring stays off until a global budget is set and `PAID_SOURCES_ENABLED=true`.

## Refinement — keyword coverage across all connectors (2026-10-16)

Every configured keyword (up to 10) is now monitored on every platform that can search it. Migrations `20261016000003` (SQL first-5 sync retired; `apply_query_groups` disables every unplanned row) and `20261016000004` (scheduler retry key) — additive, applied to the linked project after dry runs.

### Checks
| Check | Result |
|---|---|
| `npm run test:unit` | ✅ 145/145 (adds 9: no keyword dropped on any platform, all 10 keywords on HN/SO/GitHub/YouTube, GitHub OR groups split at 5, Reddit posts + comments, search budgets, fair rotation slots never over budget with equal shares, 7-day guarantee (since replaced by plan targets), ambiguous keywords with context, product query groups for all sources, development entitlement conditions; Bluesky time-window paging and refused-page handling) |
| `npm run test:db` | ✅ 223/223 (M2 query-sync tests rewritten for the new behaviour: SQL no longer writes queries; planned groups take over old rows **with their checkpoints**; unplanned rows disabled, not deleted; a failed check's retry gets a new job inside the same bucket, repeat ticks stay idempotent) |
| `npm run test:e2e` | ✅ 13/13 (Smart Monitoring now also checks keyword coverage: "Searched on 3 of 3 platforms", per-platform refresh) |
| typecheck, lint, `npm run build` | ✅ |

### Verified live (dev Supabase project, free sources only)
- ✅ `octolens` re-planned (`scripts/resync-queries.ts --apply`): 9 groups for "starlink" + "wisprflow" on HN, SO, GitHub (one OR query), Bluesky, DEV; old rows for unchanged searches were taken over with their checkpoints (HN/SO/DEV "starlink"); old rows ("octolens", "otolens.com", the old first-5 GitHub/YouTube queries) disabled, not deleted.
- ✅ A tick ran the 5 new searches: all succeeded (GitHub "starlink OR wisprflow": 14 fetched, 4 new).
- ✅ **Bluesky 403 root cause found and fixed:** the public AppView refuses `cursor` requests; a busy keyword's second page failed the whole run. After the fix the same "starlink" search succeeded: 3 pages, 293 posts, 275 new mentions, recorded *partial* (more than 300 in the window), checkpoint held.
- ✅ **Retry fix:** the Bluesky search's retry had been swallowed by the 24 h job bucket; after migration `…04` the next tick created the retry job.
- ✅ Keyword coverage card with a throwaway account (deleted): Stack Overflow without a key rotating 4 of 5 searches (2 per check, every 2 days), others every check; desktop and 375 px without horizontal scroll.

### Octolens audit
- Product `octolens` (workspace owner is the only member). Website is `https://octolens.com` — **already corrected** by the owner on 2026-10-15 15:52/15:55 UTC; verified octolens.com is "Octolens | The AI Social Listening Tool" and otolens.com doesn't resolve. No change made.
- Keyword history from query rows: originally "octolens" and **"otolens.com"** (the typo as a keyword); replaced on 2026-10-16 around 05:16 UTC with "starlink", then at 05:36 with "starlink" + "wisprflow". Neither relates to Octolens; left unchanged pending the owner's decision. (Keyword edits aren't in `audit_logs`; the only member could have made them.)

### Estimated API cost changes
- Paid platforms: **unchanged** for typical keyword sets — rotation keeps the per-check search budget (hypothetical 10 keywords: still $5.22–6.72/month on a daily plan). The 7-day guarantee can add up to ~14 % on non-OR platforms when 9 keywords rotate on a daily plan.
- `octolens`: $2.76–3.90 → $4.05–5.28/month if every paid platform were enabled daily — entirely from the second keyword added today, not from this change.
- Free sources (no money, more requests): 10 keywords now mean up to 7 HN and 7 Bluesky searches per check (was 5), 2 GitHub queries (was 1), 2 YouTube searches (was 1, shared 100/day quota), Stack Overflow ≤3 per check on average without a key (was 5, covering only 5 keywords).

### Known limitations
- A keyword busier than one check can read (Bluesky: 300 posts per run) stays *partial*; on the Free plan's 24 h interval "starlink" exceeds that every day.
- Ambiguous keywords without context words can't be searched safely anywhere; DEV can't search domains/handles (tag feeds).
- Rotating keywords on paid platforms wait up to 7 days between checks on daily plans with many keywords; each turn re-searches the whole gap (paid look-back is capped at 7 days, matching the guarantee).

## Refinement — automatic Smart Monitoring, keyword audit, Mentions UI (2026-10-16)

Customer-facing Eco/Balanced/Priority modes removed; every platform is ranked by an activity score from stored data and gets its refresh interval automatically (within plan limits). Mentions page: numbered pagination, compact cards. Migrations `20261016000001` and `…02` (additive) applied to the linked Supabase project after a dry run.

### Checks
| Check | Result |
|---|---|
| `npm run test:unit` | ✅ 137/137 (adds 18 net: activity score bounds/monotonicity/normalization, unmeasurable signals, ranking with unranked new platforms, score → interval rule, plan entitlements, paid cost step, per-platform maximum, incomplete coverage, discovery, hysteresis + dead band, spike acceleration, saturation, audits/failures/overdue, Launch Boost, efficiency, explanations, keyword plans per platform incl. Reddit posts + comments, duplicate keywords, plan cap; pagination items/ranges/boundaries/URL; mocked combined-vs-separate query comparison) |
| `npm run test:db` | ✅ 218/218 (adds 16: activity stats — relevant originals only, 24 h/7 d/28 d windows, authors, engagement vs own p75, spikes, complete vs partial coverage, discovery inputs, only enabled platforms; plan search cap in schedule context; pagination index; ranking/interval-change RLS, constraints, no customer writes) |
| `npm run test:e2e` | ✅ 13/13 in one full run (mentions: numbered pagination with ranges, aria-current, disabled ends, no duplicates/gaps across pages, back/forward, page past the end; filter persistence + reset; Read more; relevance toggles; mobile. Smart Monitoring: no mode controls, no premature efficiency %, ranking + explanations from stored data, boost → 6 h → cancel → 24 h with logged change, mobile cards) |
| typecheck, lint, `npm run build` | ✅ |

### Verified live (dev Supabase project)
- ✅ One real scheduler tick (free sources only, no API Direct key exists): the hourly ranking ran for the real `octolens` product and stored rankings from its data — keyword "starlink": Hacker News 36 relevant mentions in 7 days (score 59), GitHub 33 (62), DEV 6, Bluesky 1 — all **plan-limited to 24 h on the Free plan** (activity alone would justify 2–3 h for HN/GitHub), all still in discovery (monitored ~1 day, < 60 % of the week completely covered).
- ✅ Hysteresis on real stored data: a re-rank dropped a platform's score 59 → 50; the interval stayed (within the 5-point dead band) with the reason shown.
- ✅ UI with a throwaway account and synthetic fixtures (deleted afterwards): ranking table, expandable explanations, summary metrics, mobile cards (375 px, no horizontal scroll), light and dark; Mentions pages 1–3, filters, Read more, mobile.
- ⚠️ That tick's one monitoring job (octolens / Bluesky) failed with **403 from Bluesky**; the identical request returned 200 minutes later. Checkpoint held, rescheduled sooner. Unrelated to this change; documented in API_LIMITATIONS.md.

### Bugs found and fixed during verification
- Discovery progress read "9 of 3 checks so far" for a platform that had enough checks but not a completely covered week. Now "day 2 of 7, or sooner once a full week is completely covered".
- Engagement counted every mention as "top quarter" when all had the same engagement (ties at the 75th percentile). Now strictly above it (migration `…02`).
- Interval explanation said "checked every 24 h because activity is high" when the plan set it, and repeated the plan limit three times. Now: "…every 24 h, the most often your Free plan allows (activity is moderate: on its own that would justify every 3 h)".
- The first scoring formula capped a steady, very busy platform at 72 (never hourly). Rebalanced to a base score + growth/acceleration momentum (steady 850/week → 85, rising → 93).
- Mentions filter row wrapped the Search button onto its own line at desktop width.

### NOT verified live
- ⬜ API Direct connectors (no key; no paid request made) — automatic intervals for paid platforms are tested only in unit/DB tests.
- ⬜ A platform moving out of discovery and slowing down over days (needs days of scheduled runs; covered by unit tests with simulated time).
- ⬜ Combined OR queries returning the same mentions as separate queries on live endpoints (shown only on mocked responses).

### Known limitations
- Milestone 2 sources (Hacker News, Stack Overflow, GitHub, YouTube) still search only a product's first 5 keywords (`sync_monitoring_queries`); the rest are now reported on the Smart Monitoring page instead of silently unused.
- Paid platforms without OR search at most `max_searches_per_platform` (default 2) keywords per check; others are reported. Rotation or a higher cap is a founder decision (COST_MODEL.md).
- "Important feedback" is not part of the score until AI classification exists (M4); shown as "not measured".
- Offset pagination: if mentions arrive while someone pages, later pages can shift by a row (no duplicates or gaps on a stable dataset).

## Milestones 2.5 + 3 — multi-platform monitoring, cost control, Buzz Analytics (2026-10-15)

Local git checkpoints: `4c94fa1` (before M2.5), then M2.5/M3 commits.

### Checks
| Check | Result |
|---|---|
| `npm run test:unit` | ✅ 119/119 (adds 52: API Direct client + 10 connectors on mocked doc-shaped responses, billing rules, error/retry mapping, Reddit comment discovery, X reply/quote discovery, query optimizer + fingerprints, adaptive engine, Launch Boost, comment expansion, Bluesky/DEV/App Store normalizers, series/growth/virality/spikes/time zones) |
| `npm run test:db` | ✅ 202/202 (adds 72: pricing/budget/ledger privacy, reservations at every budget scope, zero-result billing, unanswered = unknown spend, shared-cost split, stale reservations, boost authorization + cap, source settings, query groups + streams, adaptive scheduler bucket, extended mention model, buzz series/totals/coverage incl. time zones, reconciliation of series vs totals, analytics isolation, spikes/executions isolation) |
| `npm run test:e2e` | ✅ 9/9 (adds 4: Buzz counts exclude reposts, gaps not zeros + data table, relevance view/platform filter/spike list, Smart Monitoring mode + Launch Boost create/cancel) |
| typecheck, lint, `npm run build` | ✅ (new routes `/buzz`, `/monitoring`) |
| Migrations 20261015000001–3 applied to the linked Supabase project | ✅ (`supabase db push`, dry-run first; all additive) |

### Verified live (dev Supabase project, throwaway account, free official APIs only)
- ✅ **Bluesky:** first scan stored 82 "Excalidraw" mentions (55 posts, 27 replies); **all 82 re-fetched from Bluesky's `getPosts` exist and mention Excalidraw**; 5/5 sampled links 200.
- ✅ **DEV:** tag feed returns real articles (newest first); 4/5 sampled links 200, **1 returns 404 although DEV's API still lists it**; comment expansion returned 13 comments with working links.
- ✅ **App Store feed:** 46 recent reviews for a public app; listing link 200. (Wired end-to-end only through unit tests: the test product had no App Store URL.)
- ✅ Optimizer created Bluesky/DEV query groups automatically when keywords were saved; a daily re-sync covers products nobody edits.
- ✅ Adaptive scheduling on the real database: first scheduled run was an automatic completeness audit (7-day look-back, 0 missed); decisions stored with reasons ("About 5 relevant mentions a day", "Your plan checks at most every 24 h").
- ✅ Launch Boost from the UI: boosted platforms moved 24 h → 6 h (Free plan's boost minimum) with reason "Launch Boost active until …"; unboosted GitHub stayed 24 h; times converted from the browser's zone correctly.
- ✅ Buzz Analytics with real data in Asia/Calcutta time: KPIs, stacked chart, relevant-vs-not view, data table, distributions, virality factors, spike list, coverage warnings; mobile 375 px without horizontal scroll; light and dark themes.
- ✅ Paid sources everywhere show "Not configured on this server" and cannot be turned on; the live-test script refuses without `--confirm`/budget and without a key.

### NOT verified live (built + mocked tests only)
- ⬜ **All 10 API Direct connectors** (Reddit posts + comments, X, LinkedIn, TikTok, Instagram, Facebook, Substack, web, news, Trustpilot): no `API_DIRECT_API_KEY`; **no paid request has been made**. Response schemas and the UTC reading of dates come from the docs' examples. Run the capped live test after authorizing it.
- ⬜ YouTube (no key), Supabase Cron in production (needs a deployment).
- ⬜ Shared fetches across *different workspaces* exercised only in DB tests (cost split) and unit logic, not in a live multi-customer run.

### Bugs found and fixed during verification
- Adaptive decisions read activity *before* the run stored its results ("No recent relevant mentions" right after storing 74). Context is now reloaded after ingest.
- **False spikes:** GitHub's capped backfill piled 87 issues onto two days while earlier days, covered only by a *partial* window, looked like zero → 8 "major" spikes. Spike baselines and virality now use only completely monitored periods/platforms (virality for the same data: 71 → 6).
- "Grew from zero" when the previous period was simply unmonitored. Now "No earlier data to compare".
- "100% fewer checks than hourly polling" before any check had run. Efficiency now counts only the time monitoring has actually run.
- A new Launch Boost didn't take effect until the next day (scheduler job key still in the old 24 h bucket). Starting a boost now moves boosted groups to the boost interval.
- Domains/handles (`excalidraw.com`) were treated as "covered" by the product name; DEV got a nonsense tag for a domain. Fixed; covered only for space-separated phrases, DEV keeps tag-like keywords.
- Chart date labels caused a hydration mismatch (browser vs server locale). Fixed locale.
- Coverage notices listed 10 paid sources individually and empty states promised sources that weren't enabled. Paid sources are summarized; "not enabled" is its own state.

### Known limitations
- Reddit comment results have no comment permalink (API returns the thread); stored links say "opens the thread". Comment ids are derived (author + time + thread).
- Instagram, Substack posts and web search are relevance-ranked: coverage is always "partial" and confidence never "high".
- Bluesky uses search, not Jetstream; Discord, Threads, Google Play not implemented (bot gateway process / Meta app review / customer Play credentials).
- Spike detection runs hourly from the tick; spikes have no AI explanation yet (column reserved for M4). Negative-sentiment spikes need M4 classification.
- Plan paid allowances (Free $0 / Starter $1 / Pro $5 / Business $20) are proposals awaiting a founder decision.

## Milestone 2 — real data collection (2026-10-14)

### Checks
| Check | Result |
|---|---|
| `npm run test:unit` | ✅ 67/67 (adds 30 source/relevance/pipeline tests on fixtures, 3 formatting tests) |
| `npm run test:db` | ✅ 130/130 (adds 43: query sync, scheduler idempotency, scans, token bucket, deferral, dedup/reposts, user decisions kept, monthly limit, retention, isolation of new tables) |
| `npm run test:e2e` | ✅ 5/5 Playwright (onboarding to first scan; mentions list, links, pagination, source filter, search, relevance + undo, coverage disclosure) |
| typecheck, lint, `npm run build` | ✅ |
| Migration 7 applied to the linked Supabase project | ✅ (`supabase db push`, dry-run first) |

### Verified live against real APIs (dev Supabase project, throwaway test account)
- ✅ Initial scan from the onboarding UI, worked immediately via `after()`: 292 new mentions in ~10 s (HN 23, GitHub 269, Stack Exchange 0 in 30 days) for "Excalidraw".
- ✅ **Source links are genuine:** all 23 HN mentions re-fetched from the separate official HN Firebase API exist and mention Excalidraw; sampled GitHub links return HTTP 200.
- ✅ GitHub's 1,000-result cap / page cap is reported as *partial coverage* with the reason, on Mentions, Overview and Integrations.
- ✅ Scheduled tick: incremental windows start 2 h before the last covered point; re-run stored 0 duplicates (292 → 292).
- ✅ Rate limiting: with the GitHub bucket drained, the job was deferred ~2 min with its attempt refunded (`attempts: 0`).
- ✅ `/api/jobs/tick`: 401 on a wrong secret, 405 on GET.
- ✅ Mentions page: 12 keyset pages, 292 unique rows, no repeats, newest first; source filter, dotted-term search, "needs review" filter; mark not relevant → stored as `user_irrelevant` + manual classification row, undo works; mobile 375 px without horizontal scroll.
- ✅ Keyword changes regenerate monitoring queries on the live database.

### Implemented
- ✅ Adapters: Hacker News, GitHub issues, Stack Exchange (Stack Overflow), YouTube (videos + comments) behind one interface; per-source Postgres token buckets; error classification; `Retry-After` / `x-ratelimit-reset` / `backoff` / quota resets honoured.
- ✅ Normalization: HTML/Markdown to readable text, excerpts, stable external ids, publication vs discovery time, engagement, authors where the API provides them.
- ✅ Dedup: stable-id upsert; exact duplicates (content hash) and reposts (same link) linked to the original and hidden by default; short identical texts ("+1") stay independent reports.
- ✅ Deterministic relevance with stored matched terms and score; ambiguous keywords need context; exclusion terms; issue-template dumps ignored; "needs review" status.
- ✅ Job system: scheduler, worker, scans with live progress, job history (Integrations → Monitoring activity), failed windows recorded as coverage gaps, daily retention purge.
- ✅ UI: real first-scan step, Mentions page, live source status on Integrations, coverage notice on every data page, Overview "recent mentions" from stored rows.

### Bugs found and fixed during M2 verification
- A VS Code bug matched "Excalidraw" at 0.9 confidence only because of an installed-extensions dump. Matching now ignores `<details>` dumps and treats code blocks as weak evidence.
- GitHub excerpts showed raw Markdown/HTML. Now converted to text.
- Scan summary said "(4 already known)" for items two keywords both found in the same scan. It now reports new mentions per source.
- User-typed plain words ("timer", "whiteboard") were matched at full confidence. They now default to "needs context" (overridable).
- YouTube quota was modelled as 100 units of the shared pool; Google's current docs give `search.list` its own 100/day bucket. Adapter fixed.
- Overview card overflowed with long titles (grid track sizing).

### Not verified / limitations
- ⬜ **YouTube live:** no `YOUTUBE_API_KEY` on this server; adapter covered only by fixture tests. Shows "Not configured" everywhere until a key is added.
- ⬜ **Supabase Cron in production:** SQL documented; needs a deployed, publicly reachable app.
- No `GITHUB_TOKEN` / `STACKEXCHANGE_KEY` yet → 10 GitHub searches/min and 300 Stack Exchange requests/day shared by all customers.
- GitHub: issues only (no PRs, comments, discussions). Stack Exchange: Stack Overflow only, no authors.
- Already-stored mentions are not re-matched when keywords change (the keywords page says so).
- User relevance feedback is stored (status + classification history) but doesn't yet change filtering automatically; that comes with M4's classifier.
- Relevance buttons are client-side form actions: a click in the first moment before hydration is ignored.
- A popular product can use the Free plan's 500 mentions/month in one initial scan (Excalidraw: 292 in 30 days). The limit is enforced and reported; consider a smaller initial lookback for Free.

## Milestone 1 checklist

### Database (✅ 87/87 tests passing)
- ✅ Schema for all 32 tables covering every entity in the spec (tenancy, plans, products, aliases, competitors, events, integrations, secrets, AI connections, monitoring queries, jobs, coverage, mentions, classifications, clusters, daily stats, AI usage/investigations, notifications, reports, audit)
- ✅ RLS on every table; per-table/column grants; anon sees only public plans
- ✅ Cross-workspace isolation (read, insert, update, delete, RPC, profile pointer)
- ✅ Composite FKs block cross-tenant linking even for the service role
- ✅ Plan limits enforced in DB, follow subscription status, race-safe, and don't leak plan info to outsiders
- ✅ Last-owner protection; viewer role is read-only; users can't self-upgrade, forge AI classifications or edit mention content
- ✅ Job queue: idempotent enqueue, exclusive claim, exponential backoff, dead-lettering, lease-expiry recovery, stale-worker rejection, named locks
- ✅ Mention dedup unique key; daily-stats uniqueness with null competitor
- ✅ Account deletion: sole-owner workspaces deleted, shared ones left, refuses when ownership must be transferred; paid workspaces can't be deleted before cancellation
- ✅ Audit log entries visible to owners/admins only
- ✅ Service-only RPC wrappers not callable by users or anon

### Domain & validation (✅ 33/33 unit tests passing, strict typecheck clean)
- ✅ URL normalization with SSRF guards; GitHub / App Store / Play URL parsing; open-redirect guard
- ✅ Keyword suggestions: exact name, spacing variants, initials (opt-in), domain, repo, handles; ambiguity detection with required context terms
- ✅ Plan helpers mirror DB semantics
- ✅ Date ranges (presets, custom, UTC, clamping, previous window)
- ✅ AI key shape checks; integration catalog honesty test (nothing marked available)
- ✅ AES-256-GCM: round trip, fresh IV, workspace binding, tamper detection, key rotation
- ✅ Zod schemas for auth, workspace, product, keywords

### Application (✅ builds; flows below exercised in a browser unless marked)
- ✅ Design system: tokens (light/dark both checked), primitives, form fields with accessible errors
- ✅ Email verification link → `/auth/confirm` → onboarding; account deletion (auth user, workspace, product, keywords all gone)
- 🟡 Email/password sign-in form, forgot/reset password: built, not exercised in the browser (automation doesn't type passwords)
- ⬜ Google OAuth: code path built; provider not yet enabled in Supabase (see ENVIRONMENT_SETUP.md §2)
- ✅ Proxy session refresh + route protection
- ✅ Workspace create; 🟡 switch/rename/delete not exercised
- ✅ Onboarding: product (validation + private-URL rejection) → keywords (ambiguity guard) → sources (honest catalog) → AI (credits) → scan (honest "no sources live")
- 🟡 BYOK key save: encryption unit-tested; not entered through the UI (automation doesn't type API keys)
- ✅ App shell: desktop sidebar, mobile sheet, no horizontal scroll at 375px
- ✅ Overview empty state discloses "Sources included: none yet"; settings: products, keywords, plan & billing, account

### Bugs found and fixed during verification
- Forms lost every typed value after a validation error (React 19 resets forms after an action). Added `useFormAction` (`src/components/ui/form.tsx`), which keeps submitted non-secret values; password/key fields are never echoed.
- Keyword editor: context terms only committed on blur, so typing context then clicking "enable" auto-enabled and then immediately disabled the keyword. Now commits on change.
- `.env.example` contained the project's real Supabase secret key. Replaced with blanks. **Rotate that key** (see below).
- DB test runner required system Postgres + psql; replaced with `scripts/test-db.mjs` (embedded Postgres 17, no install needed). `rls_test.sql` no longer uses psql-only `\gset`.

### M1 acceptance flow
1. ✅ Sign-up verification link lands on /onboarding (link generated with the admin API; real inbox delivery depends on your Supabase email template + SMTP).
2. ✅ Create workspace → product (private URL rejected, values kept) → keywords (ambiguous term blocked until context added) → sources → AI → scan → overview.
3. ✅ Second product on Free: blocked in UI and by the database ("Product limit reached for this plan (1 allowed)").
4. ✅ Second account cannot read/update/insert into the first account's workspace, product or keywords; cannot self-upgrade plan; cannot read `credential_secrets`; anon sees nothing.
5. 🟡 AI key save via UI — do once by hand: Settings → AI providers.
6. ✅ Delete account → auth user, workspace, product and keywords removed.

## Known limitations / follow-ups
- Supabase-generated DB types not yet added (`supabase gen types`); rows are cast at boundaries. Add in M2.
- Workspace-wide notifications share one `read_at`; per-user read state comes with M6 notifications work.
- Member invitations not implemented (schema supports roles).
- Auth rate limiting relies on Supabase Auth's built-in limits; app-level rate limits for expensive actions arrive with M2's limiter table.
- BYOK keys are stored as "unverified"; live validation call lands in M4.
- "Continue with Google" is shown even while the provider is disabled in Supabase; it returns a clear "not available" message. Enable the provider or hide the button before launch.
- Custom keywords are auto-flagged ambiguous only if short or in the built-in common-word list (e.g. "whiteboard" wasn't). Users can tick "Needs context"; M2's relevance pipeline adds a second line of defence.
