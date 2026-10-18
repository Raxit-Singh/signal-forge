# SignalForge

Social listening, buzz analytics and product intelligence for software teams: where people talk about your product, how often, what they like and dislike, which bugs and feature requests come up, and what to look at next — with every number traceable to stored data.

**Status (2026-10-16): Milestones 1, 2, 2.5 and 3 implemented, plus the Discovery Engine V2 (product-adaptive arrival-rate monitoring with brand-safe pacing, right-sized and resumable pagination, historical search at onboarding, statistical spike detection with confirmed / possible / insufficient-data states, realtime dashboard updates), keyword coverage across all connectors, and the Free / Pro / Scale plans ($0 / $100 / $300 per month; 1 / 10 / 40 keywords; 100 / 15,000 / 50,000 mentions per billing period) with mention allowances.** Free sources (Hacker News, GitHub, Stack Overflow, Bluesky, DEV, App Store reviews) are verified against their live APIs. API Direct: 9 search endpoints (Reddit posts and comments, X, LinkedIn, TikTok, Instagram, Facebook, Substack, Google web) passed one capped live test ($0.048); Google News, Trustpilot, the comment/reply expansion endpoints and YouTube are still mocked-only or unverified. Paid monitoring is off until a global budget is configured. Payments are not integrated yet. See [PROGRESS.md](PROGRESS.md) for the exact verification log.

## Stack

Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 · shadcn-style components on Radix · Lucide · Recharts (from M3) · Zod 4 · Supabase (Postgres, Auth, RLS) · Postgres-backed job queue driven by Supabase Cron · Stripe (M6).

A modular monolith: one Next.js app, one Postgres database. No extra services until something actually needs one.

## Quick start

```bash
cp .env.example .env.local          # fill in Supabase keys + an encryption key
npm install
npx supabase link --project-ref <ref> && npx supabase db push   # apply migrations
npm run dev
```

Full setup (Supabase auth settings, email templates, Google OAuth, keys): [ENVIRONMENT_SETUP.md](ENVIRONMENT_SETUP.md).

## Checks

| Command | What it runs | Needs |
|---|---|---|
| `npm run test:unit` | 199 tests: domain logic (plans, internal grants, usage warnings, keyword allowance, historical date selection, broad-keyword warnings), validation, encryption, source adapters incl. API Direct (mocked responses), query optimizer + keyword plans + fair rotation, plan targets + paid pacing, arrival-rate model, V2 intervals + brand-safe pacing + page right-sizing, resumable gaps, backfill planning, comment expansion, analytics math incl. V2 spikes, pagination (`node --test`) | Node ≥ 22.18 |
| `npm run test:db` | All migrations + 284 RLS / isolation / plan-limit / keyword-allowance / mention-billing (incl. a two-connection concurrency test) / job-queue / ingestion / budget / analytics / activity-ranking / realtime-event / backfill tests on a throwaway local Postgres | Nothing extra — uses the `embedded-postgres` dev dependency (set `PGBIN` to use a system Postgres) |
| `npm run typecheck` | `tsc --noEmit` over the whole app | `npm install` |
| `npm run lint` | ESLint (next/core-web-vitals + typescript) | `npm install` |
| `npm run build` | Production build | `npm install`, env vars |
| `npm run test:e2e` | Playwright (21 tests): onboarding incl. historical search selection; realtime updates, new-mentions notice and Realtime workspace isolation; backfill progress; overflow risk and spike confidence; plans, usage warnings and keyword allowance; effective keyword refresh intervals; mentions numbered pagination, filters, Read more, relevance, mobile; Buzz Analytics; automatic Smart Monitoring ranking, keyword coverage, explanations, Launch Boost, mobile (deterministic fixtures) | `.env.local`, `npx playwright install chromium` |
| `npm run audit:keywords -- [--product <id>] [--keywords "a:exact_name,b:domain"]` | Read-only: configured keywords, query groups per platform, what isn't searched and why, estimated monthly requests and API Direct cost | `.env.local` |
| `npm run test:apidirect-live -- --confirm --max-usd 0.05 --provider-limit-confirmed` | **Paid.** Live check of API Direct connectors with a cumulative per-session cap enforced through `api_cost_ledger` (`--plan` prints the plan and worst case without sending). Never runs in CI | `API_DIRECT_API_KEY`, your authorization |
| `npm run dev:cron` | Calls the scheduler every 120 s for a server not started with `npm run dev` (which ticks itself) | `JOBS_TICK_SECRET` |

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — modules, data model, security model, job system
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — milestones and acceptance criteria
- [PROGRESS.md](PROGRESS.md) — checklist and verification log
- [ENVIRONMENT_SETUP.md](ENVIRONMENT_SETUP.md) — credentials and external setup
- [API_LIMITATIONS.md](API_LIMITATIONS.md) — what each platform allows
- [COST_MODEL.md](COST_MODEL.md) — operating costs, measured vs assumed

## Layout

```
src/
  app/
    (auth)/          sign-in, sign-up, password reset (+ server actions)
    auth/            /auth/callback (Google/GitHub/X OAuth, PKCE), /auth/confirm (email links: token_hash or PKCE code)
    onboarding/      workspace → product → keywords → sources → AI → historical search
    (app)/           authenticated shell: overview, mentions, buzz, feedback,
                     competitors, insights, integrations, reports, settings
    actions/         server actions (workspace, product, scans, mentions, AI, developer agent, account, notifications)
    api/mcp          SignalForge remote MCP server (Claude connector); api/oauth + .well-known: its OAuth 2.1 server
    api/jobs/tick/   scheduler endpoint (secret-protected)
  components/        ui primitives, app shell, product form, keyword editor, history form/progress, realtime provider, …
  lib/
    domain/          pure logic (urls, aliases, plans, date ranges, catalogs) + tests
    validation/      zod schemas + tests
    sources/         source adapters (HN, GitHub, Stack Exchange, YouTube, Bluesky, DEV, App Store),
                     apidirect/ (client, endpoint catalog, schemas, normalizers, 10 paid connectors),
                     query optimizer, adaptive engines (V1 signals, V2 arrival rates), collection profiles,
                     resumable gaps, backfill planning, comment expansion, relevance, text + tests
    analytics/       buzz math: series with gaps, growth, virality, spike detection + tests
    server/          session/authorization, encryption, env; collection/ = worker, monitor, scheduler,
                     query sync, cost-aware context, status; analytics/ = dashboard + spike jobs
    supabase/        server / browser / admin clients
  proxy.ts           session refresh + route protection (Next 16 "proxy")
supabase/
  migrations/        schema, RLS, job queue, RPCs
  tests/             local harness + database tests
e2e/                 Playwright specs + throwaway-account helpers
scripts/test-db.mjs  runs migrations + DB tests on a temporary Postgres 17 cluster
scripts/dev-cron.mjs local scheduler
scripts/apidirect-live-test.ts  authorized, budget-capped paid connector check
scripts/simulate-plan-costs.ts  read-only paid cost / freshness / backfill simulation (V2; --v1 for the previous engine)
```

## Two AI systems

- **SignalForge Intelligence** (paid by SignalForge, Gemini): classifies collected mentions (relevance in shadow mode, product-targeted sentiment, categories, severity), groups feedback into prioritised issues by meaning, and explains spikes with cited posts. Customers connect nothing. Off until the operator configures it (ENVIRONMENT_SETUP.md §3c).
- **Developer agent** (the customer's own Claude): customers add SignalForge as a custom connector in Claude (OAuth), link their GitHub repository, and optionally a Claude Code routine. "Investigate with Claude" → report → explicit, single-use approval of that exact plan → implementation and a pull request for human review. Runs on the customer's Claude subscription; SignalForge never merges or deploys. Limits: API_LIMITATIONS.md → "Developer agent".
