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
