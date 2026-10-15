# SignalForge

Social listening, buzz analytics and product intelligence for software teams: where people talk about your product, how often, what they like and dislike, which bugs and feature requests come up, and what to look at next — with every number traceable to stored data.

**Status: Milestone 1 (foundation) — code complete, partially verified.** See [PROGRESS.md](PROGRESS.md) for exactly what has and hasn't been verified. No monitoring runs yet; the app says so instead of showing sample data.

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
| `npm run test:unit` | Domain logic, validation, encryption, source adapters (fixtures), relevance, formatting (`node --test`) | Node ≥ 22.18 |
| `npm run test:db` | All migrations + 130 RLS / isolation / plan-limit / job-queue / ingestion tests on a throwaway local Postgres | Nothing extra — uses the `embedded-postgres` dev dependency (set `PGBIN` to use a system Postgres) |
| `npm run typecheck` | `tsc --noEmit` over the whole app | `npm install` |
| `npm run lint` | ESLint (next/core-web-vitals + typescript) | `npm install` |
| `npm run build` | Production build | `npm install`, env vars |
| `npm run test:e2e` | Playwright: onboarding flow; mentions list, pagination, filters, relevance (deterministic fixtures) | `.env.local`, `npx playwright install chromium` |
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
    sources/         source adapters (HN, GitHub, Stack Exchange, YouTube), relevance, text + tests
    server/          session/authorization, encryption, env; collection/ = worker, scheduler, status
    supabase/        server / browser / admin clients
  proxy.ts           session refresh + route protection (Next 16 "proxy")
supabase/
  migrations/        schema, RLS, job queue, RPCs
  tests/             local harness + database tests
e2e/                 Playwright specs + throwaway-account helpers
scripts/test-db.mjs  runs migrations + DB tests on a temporary Postgres 17 cluster
scripts/dev-cron.mjs local scheduler
```
