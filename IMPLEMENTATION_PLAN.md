# Implementation plan

Starting point (2026-10-14): empty project. Each milestone ends with tests, typecheck, lint, a manual pass over its user flows, and an update to PROGRESS.md. A milestone is not "done" because code exists.

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Architecture | Modular monolith (Next.js + Supabase) | Two free-tier services, one deploy, no queue/infra to run. |
| Job queue | Postgres table + `SKIP LOCKED` leases, triggered by Supabase Cron → `/api/jobs/tick` | Idempotent, retryable, crash-safe, observable in SQL; no Redis/QStash bill. Host-agnostic, so Vercel Hobby's once-a-day cron limit doesn't matter. |
| Hosting | Vercel Hobby for development; **Vercel Pro (US$20/mo) or a commercial-use-permitted alternative before charging customers** | Vercel Hobby is restricted to non-commercial, personal use. |
| Plan limits | DB rows + DB triggers | Prices/limits change without deploys; enforcement can't be bypassed by the UI. |
| Plans (2026-10-16) | Free $0 / Pro $100 / Scale $300, monthly only; keywords 1/10/40 per workspace; mentions 100/15,000/50,000 per billing period | Mention-based allowance; Starter/Business retired (hidden, kept). |
| Mention billing (interim) | Count new unique originals with rule status "relevant" or marked relevant; hold (don't discard) beyond 100 % | AI relevance arrives in M4; no retroactive changes to past periods. |
| Secrets | App-layer AES-256-GCM, service-role-only table | Works on Supabase free tier (no Vault dependency), rotatable, workspace-bound. |
| Analytics | Pre-aggregated UTC daily stats + coverage windows | Fast charts; honest about gaps. |
| AI | Provider abstraction, cheap-model-first staged pipeline, per-workspace budgets | Cost control; BYOK supported. |
| Unit tests | `node --test` on pure modules | Zero extra dependencies; runs anywhere. E2E with Playwright from M2. |

## External credentials and approvals

| Need | For | When | Cost |
|---|---|---|---|
| Supabase project (URL, publishable + secret keys) | Everything | M1 | Free tier |
| Google OAuth client (Google Cloud) | Google sign-in | M1 (optional) | Free |
| SMTP provider for Supabase Auth emails | Reliable signup/reset emails (Supabase's built-in sender is rate-limited and meant for testing) | Before real users | Free tiers exist; decide in M6 |
| GitHub token / GitHub App | Public issue search (M2); repo connection (M5) | M2 / M5 | Free |
| YouTube Data API key (Google Cloud) | Video + comment discovery | M2 | Free quota |
| Stack Apps key | Higher Stack Exchange quota | M2 | Free |
| Anthropic / OpenAI / Gemini API keys | SignalForge AI credits | M4 | Pay-per-use — **ask founder before enabling** |
| Stripe account + products | Subscriptions | M6 | Transaction fees — **ask founder** |
| Discord application (bot) | Discord connector | M6 | Free; privileged intent approval at scale |
| App Store Connect / Play Console | Review connectors (customer-provided keys) | M6 | Customer's own accounts |

## Milestones

### M1 Foundation — *verified 2026-10-14* (see PROGRESS.md; Google OAuth awaits provider setup)
Next.js app, design system, auth (email+password, Google, verification, reset, account deletion), full DB schema with RLS, workspaces, onboarding (product → keywords → sources → AI → scan).
**Acceptance:** a user can register, create a workspace, and add a product.

### M2 Real data collection — *verified 2026-10-14* (YouTube built but not live-verified: needs `YOUTUBE_API_KEY`; see PROGRESS.md)
Implemented as planned with these changes: GitHub searches issues only (one combined OR query; PRs later); YouTube `search.list` uses its own 100/day bucket; initial scans run immediately via `after()` rather than waiting for the scheduler.

1. Adapter interface + registry; per-source rate limiter (token bucket in Postgres) and `api_usage_events`.
2. Hacker News adapter (Algolia `search_by_date`, `created_at_i` cursor). Simplest; proves the pipeline end-to-end.
3. GitHub adapter (issues/PR search, `is:issue` / `is:pr` separately, 30 req/min, 1,000-result cap → narrow windows).
4. Stack Exchange adapter (key, `backoff` honoured).
5. YouTube adapter (search.list budgeted from a shared 100/day bucket; cache results; comments via commentThreads).
6. Normalization + dedup (stable ids; content hash for exact duplicates; repost linking; independent reports never merged by similarity alone).
7. Deterministic relevance: keyword/alias match, ambiguity context terms, negative terms; store matched terms and score.
8. `/api/jobs/tick` worker + Supabase Cron schedule; coverage windows; job history page in settings.
9. Initial scan on onboarding with real progress from `jobs.progress`.
10. Mentions page: server-side pagination (keyset), filters, source links, mark relevant/irrelevant.
11. Playwright E2E: signup → onboarding → scan → mentions.
**Acceptance:** genuine mentions are discovered, stored once, and displayed with working source links.

### M2.5 Multi-platform monitoring infrastructure — *implemented 2026-10-15; free sources verified live, API Direct connectors mocked-only (no key)* (see PROGRESS.md)
Constraints: API Direct is the only paid social-data provider; no paid call is made automatically during development, in tests or in CI; paid collection needs a key **and** an operator-set global budget **and** `PAID_SOURCES_ENABLED=true`.

Facts from API Direct's docs (github.com/joshwallerr/apidirect-docs, read 2026-10-15) that shape the design:
- `X-API-Key` auth, `GET /v1/<platform>/<resource>`, JSON errors `{error, code}`; 10 concurrent requests per endpoint.
- Billed per *answered* request: 2xx (including **zero results**) and 404; `pages=N` endpoints bill **per page requested**.
- Reddit comment search returns no comment id or permalink: `url` is the parent thread (or the shared link). Stable ids are derived from author + timestamp + parent; links are labelled "opens the thread".
- Only Reddit, X, LinkedIn (and Bluesky, Google forums) accept boolean operators; TikTok, Instagram, Facebook, YouTube are plain keyword search.
- Date strings have no zone; examples with Unix timestamps match UTC, so they are parsed as UTC.

Steps:
1. Additive migrations: new platform enum values; `mentions` gains mention type, collection method, community, link target, data provider, estimated-date flag; `monitoring_queries` gains stream, fingerprint, adaptive-schedule state; new tables `provider_pricing`, `api_budgets`, `api_cost_ledger`, `api_cost_allocations`, `monitoring_executions`, `product_source_settings`, `launch_boosts`, `comment_expansions`, `buzz_spikes`, `billing_reconciliations`. Atomic `reserve_api_spend` / `settle_api_spend`.
2. `src/lib/sources/apidirect/`: client (validation, timeout via context, retry/backoff for transient codes, error mapping, billability rules), endpoint catalog, response schemas (zod), normalizers.
3. Reddit (posts + comments as separate streams/checkpoints), X (search incl. replies/quotes, selective reply/quote expansion), LinkedIn, TikTok, Instagram, Facebook, Substack (posts + notes), Google web, Google News, Trustpilot.
4. Query optimizer with per-connector capability declarations; shared query fingerprints; one upstream fetch fans out to every product with the same fingerprint (results are not cached afterwards).
5. Adaptive monitoring engine (deterministic), modes eco/balanced/priority, Launch Boost, safety rules (max interval, saturation, audits, failure recovery). *Modes replaced on 2026-10-16 by automatic activity ranking (below).*
6. Cost control: pricing registry in the DB, budgets at global/provider/platform/workspace/product/boost scope, reservations before each paid call, ledger + reconciliation.
7. Comment expansion engine for platforms without global comment search.
8. Official sources: Bluesky (AppView search), DEV (Forem tag feed + comments), App Store (customer-review feed). Discord, Threads and Google Play stay disabled (need a bot gateway process, Meta app review, or the customer's Play Console credentials).

### Refinement: automatic Smart Monitoring + Mentions UI — *implemented and verified 2026-10-16* (see PROGRESS.md)
1. Additive migrations `20261016000001/2`: `platform_activity`, `monitoring_interval_changes`, `plan_paid_allowances.max_searches_per_platform` (default 2 = old default), `private.platform_activity_stats`, mention pagination index.
2. Pure engine (`adaptive.ts`): activity score 0–100 from stored data, ranking, discovery phase, score → interval with safeguards, hysteresis, plan/boost/source limits; deterministic explanations (`explain.ts`).
3. Server: re-rank after every run and hourly; apply intervals to query groups (shorter at once; missed-run recovery); log interval changes. Boost start/cancel re-ranks.
4. Keyword engine audit: single planner (`keyword-plan.ts`) for worker, UI and `npm run audit:keywords`; duplicates and unsupported keywords reported; free platforms without OR search every keyword; paid cap per plan.
5. Smart Monitoring page: automatic overview, summary metrics with honest denominators, ranking table (desktop) / cards (mobile) with expandable explanations; mode selection removed.
6. Mentions: numbered offset pagination (URL `page`), type filter, compact cards with Read more, labelled relevance toggles, mobile layout.
**Acceptance:** no mode selection; rankings and intervals from real data; plan limits and budgets unchanged; numbered pagination with persistent filters — all covered by unit, DB and browser tests.

### Refinement: keyword coverage across all connectors — *implemented and verified 2026-10-16* (see PROGRESS.md)
Every configured keyword monitored wherever it can be searched: OR consolidation, fair rotation with per-search checkpoints (the 7-day guarantee was later replaced by plan targets), Milestone 2 sources moved to the planner (first-5 limit removed), keyword-level coverage on Smart Monitoring, development-only interval entitlement, scheduler retry fix, Bluesky pagination fix. Migrations `20261016000003/4`.

### Refinement: subscription restructure, mention allowances, API Direct live validation — *implemented and verified 2026-10-16* (see PROGRESS.md)
Free/Pro/Scale plans from the `plans` table; workspace keyword allowance (DB trigger + editor); billing periods anchored on the subscription; billable-mention metering with row-locked usage periods, refunds within the period, a bounded overflow queue and paid-collection pause at 100 %; 80/90/100 % warnings; plan keyword refresh targets (7 d / 24 h / 6 h) with recorded conflicts; paid-budget pacing (Pro $25, Scale $75 internal targets); scheduler priority by plan. Capped API Direct live test ($0.048 of $0.05): 9 endpoints verified, LinkedIn date bug fixed. Migration `20261016000005`.

### Refinement: Discovery Engine V2 — pagination, adaptive monitoring, historical search, spikes, realtime — *implemented and verified 2026-10-16* (see PROGRESS.md)
1. Pagination audit and collection profiles (provider vs application limits, history depth); page right-sizing for page-billed endpoints with one escalation; exact page counts; fixed caps (e.g. Bluesky's 300 posts) replaced by resumable collection — gaps continued by date-range splitting or page offsets, unreachable parts recorded as partial.
2. Product-adaptive engine: per-query-group Gamma–Poisson arrival rates; importance (product-relative share), urgency (freshness + brand-safe bound) and uncertainty kept separate; quiet-platform exploration; hysteresis; brand-safe budget pacing that reports risk instead of slowing busy searches.
3. Historical search: onboarding question (default 30 days, launch date required for "since launch", plan window enforced, exact dates shown), broad-keyword and allowance warnings (estimates only from measured data), resumable backfill tasks with real states and allowance pause.
4. Spikes: audit (why none were stored), statistical detection against each product's own baseline at product, platform and keyword level with confirmed / possible / insufficient data; coverage "partial wins".
5. Realtime: workspace-scoped events → Supabase Realtime → refetch, with recovery, fallback polling, and the Mentions "new mentions" notice.
Migrations `20261016000007/8`. Budgets, prices and mention allowances unchanged; no paid calls.
**Acceptance:** see the checklist in PROGRESS.md — all automated checks pass; coverage limits are shown, never hidden.

### M3 Buzz analytics — *implemented and verified 2026-10-15* (see PROGRESS.md)
Implemented on live SQL over deduplicated mentions (originals only) rather than the UTC `daily_mention_stats` table, so days follow the viewer's time zone; mentions with estimated dates (web results) are excluded from time series and counted separately.
Daily aggregation job (idempotent recompute per day/product/source), charts (24h/7d/30d/90d/custom, per-platform filter), growth with zero-denominator handling, source distribution, unique authors, engagement, share of voice, experimental virality score with factor breakdown, spike detection (rolling median/MAD baseline + minimum counts), event markers.
**Acceptance:** every displayed metric reconciles with stored rows (property tests on the aggregation).

### M4 AI intelligence
Provider abstraction (Claude, OpenAI, Gemini), BYOK validation call, budget + quota checks before each call, caching by content hash, staged pipeline (rules → dedup → cheap classifier → clustering → deep analysis on demand), product-targeted sentiment, feedback categories, clusters with evidence, spike explanations that cite mentions or say "insufficient data". Prompt-injection hardening: content passed as quoted data, no tool access, outputs validated by schema.
**Acceptance:** every AI output links to evidence; AI failures leave analytics untouched.

### M5 Product intelligence
GitHub App (read-only), selective file retrieval, product knowledge base, duplicate-issue detection, investigation reports (confirmed / hypotheses / assumptions), feature evaluation, issue drafts created only after explicit confirmation.
**Acceptance:** useful, evidence-based reports with zero unauthorized repository writes.

### M6 Monetization & launch
Stripe Checkout + Billing Portal (create products/prices for Pro $100 and Scale $300 then set `plans.stripe_price_id`), verified webhooks (idempotent via `billing_events`) that write `subscriptions.current_period_start/end` (usage periods follow them automatically) and call `release_held_mentions` after an upgrade if the customer opts in, plan changes, dunning; email notifications + weekly report email; App Store Connect, Google Play and Discord connectors; admin cost dashboard; retention purge job; member invitations; security review; production deploy.
**Acceptance:** a customer can subscribe, stay within limits, and receive reliable recurring monitoring.
