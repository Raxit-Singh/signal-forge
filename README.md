# SignalForge

Social listening, buzz analytics and product intelligence for software teams: where people talk about your product, how often, what they like and dislike, which bugs and feature requests come up, and what to look at next — with every number traceable to stored data.

**Status (2026-10-16): Milestones 1, 2, 2.5 and 3 implemented, plus automatic Smart Monitoring (platforms ranked by activity; no monitoring modes to choose) and numbered mention pagination.** Free sources (Hacker News, GitHub, Stack Overflow, Bluesky, DEV, App Store reviews) are verified against their live APIs. YouTube and all ten API Direct (paid) connectors are built and tested with mocked responses only — they need credentials (and, for paid sources, an authorized test budget) before they can be called verified. Buzz Analytics and Smart Monitoring are verified in the browser. See [PROGRESS.md](PROGRESS.md) for the exact verification log.

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
| `npm run test:unit` | 145 tests: domain logic, validation, encryption, source adapters incl. API Direct (mocked responses), query optimizer + keyword plans + fair rotation, activity ranking, automatic intervals + hysteresis, comment expansion, analytics math, pagination (`node --test`) | Node ≥ 22.18 |
| `npm run test:db` | All migrations + 223 RLS / isolation / plan-limit / job-queue / ingestion / budget / analytics / activity-ranking tests on a throwaway local Postgres | Nothing extra — uses the `embedded-postgres` dev dependency (set `PGBIN` to use a system Postgres) |
| `npm run typecheck` | `tsc --noEmit` over the whole app | `npm install` |
| `npm run lint` | ESLint (next/core-web-vitals + typescript) | `npm install` |
| `npm run build` | Production build | `npm install`, env vars |
| `npm run test:e2e` | Playwright (13 tests): onboarding; mentions numbered pagination, filters, Read more, relevance, mobile; Buzz Analytics; automatic Smart Monitoring ranking, keyword coverage, explanations, Launch Boost, mobile (deterministic fixtures) | `.env.local`, `npx playwright install chromium` |
| `npm run audit:keywords -- [--product <id>] [--keywords "a:exact_name,b:domain"]` | Read-only: configured keywords, query groups per platform, what isn't searched and why, estimated monthly requests and API Direct cost | `.env.local` |
| `npm run test:apidirect-live -- --confirm --max-usd 0.05` | **Paid.** Budget-capped live check of API Direct connectors. Never runs in CI or without `--confirm` | `API_DIRECT_API_KEY`, your authorization |
| `npm run dev:cron` | Calls the scheduler every 120 s during local development | `JOBS_TICK_SECRET` |

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
    auth/            /auth/callback (OAuth PKCE), /auth/confirm (email token_hash)
    onboarding/      workspace → product → keywords → sources → AI → first scan
    (app)/           authenticated shell: overview, mentions, buzz, feedback,
                     competitors, insights, integrations, reports, settings
    actions/         server actions (workspace, product, scans, mentions, ai keys, account, notifications)
    api/jobs/tick/   scheduler endpoint (secret-protected)
  components/        ui primitives, app shell, product form, keyword editor, …
  lib/
    domain/          pure logic (urls, aliases, plans, date ranges, catalogs) + tests
    validation/      zod schemas + tests
    sources/         source adapters (HN, GitHub, Stack Exchange, YouTube, Bluesky, DEV, App Store),
                     apidirect/ (client, endpoint catalog, schemas, normalizers, 10 paid connectors),
                     query optimizer, adaptive engine, comment expansion, relevance, text + tests
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
```
