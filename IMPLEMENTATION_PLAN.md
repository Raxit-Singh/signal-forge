# Implementation plan

Starting point (2026-10-14): empty project. Each milestone ends with tests, typecheck, lint, a manual pass over its user flows, and an update to PROGRESS.md. A milestone is not "done" because code exists.

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Architecture | Modular monolith (Next.js + Supabase) | Two free-tier services, one deploy, no queue/infra to run. |
| Job queue | Postgres table + `SKIP LOCKED` leases, triggered by Supabase Cron → `/api/jobs/tick` | Idempotent, retryable, crash-safe, observable in SQL; no Redis/QStash bill. Host-agnostic, so Vercel Hobby's once-a-day cron limit doesn't matter. |
| Hosting | Vercel Hobby for development; **Vercel Pro (US$20/mo) or a commercial-use-permitted alternative before charging customers** | Vercel Hobby is restricted to non-commercial, personal use. |
| Plan limits | DB rows + DB triggers | Prices/limits change without deploys; enforcement can't be bypassed by the UI. |
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

### M3 Buzz analytics
Daily aggregation job (idempotent recompute per day/product/source), charts (24h/7d/30d/90d/custom, per-platform filter), growth with zero-denominator handling, source distribution, unique authors, engagement, share of voice, experimental virality score with factor breakdown, spike detection (rolling median/MAD baseline + minimum counts), event markers.
**Acceptance:** every displayed metric reconciles with stored rows (property tests on the aggregation).

### M4 AI intelligence
Provider abstraction (Claude, OpenAI, Gemini), BYOK validation call, budget + quota checks before each call, caching by content hash, staged pipeline (rules → dedup → cheap classifier → clustering → deep analysis on demand), product-targeted sentiment, feedback categories, clusters with evidence, spike explanations that cite mentions or say "insufficient data". Prompt-injection hardening: content passed as quoted data, no tool access, outputs validated by schema.
**Acceptance:** every AI output links to evidence; AI failures leave analytics untouched.

### M5 Product intelligence
GitHub App (read-only), selective file retrieval, product knowledge base, duplicate-issue detection, investigation reports (confirmed / hypotheses / assumptions), feature evaluation, issue drafts created only after explicit confirmation.
**Acceptance:** useful, evidence-based reports with zero unauthorized repository writes.

### M6 Monetization & launch
Stripe Checkout + Billing Portal, verified webhooks (idempotent via `billing_events`), plan changes, dunning, usage resets; email notifications + weekly report email; App Store Connect, Google Play and Discord connectors; admin cost dashboard; retention purge job; member invitations; security review; production deploy.
**Acceptance:** a customer can subscribe, stay within limits, and receive reliable recurring monitoring.
