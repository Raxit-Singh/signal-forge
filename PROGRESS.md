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

## Refinement — keyword coverage across all connectors (2026-10-16)

Every configured keyword (up to 10) is now monitored on every platform that can search it. Migrations `20261016000003` (SQL first-5 sync retired; `apply_query_groups` disables every unplanned row) and `20261016000004` (scheduler retry key) — additive, applied to the linked project after dry runs.

### Checks
| Check | Result |
|---|---|
| `npm run test:unit` | ✅ 145/145 (adds 9: no keyword dropped on any platform, all 10 keywords on HN/SO/GitHub/YouTube, GitHub OR groups split at 5, Reddit posts + comments, search budgets, fair rotation slots never over budget with equal shares, 7-day guarantee, ambiguous keywords with context, product query groups for all sources, development entitlement conditions; Bluesky time-window paging and refused-page handling) |
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
