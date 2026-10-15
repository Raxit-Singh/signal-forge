# Architecture

## Shape

One Next.js application (UI, server actions, route handlers, and later the job worker endpoint) and one Supabase Postgres database. Postgres is also the queue, the lock service and the analytics store. This keeps the free-tier footprint to two services and the operational surface to one codebase.

```
Browser ──► Next.js (Vercel / any Node host)
              ├─ proxy.ts            refresh Supabase session, gate app routes
              ├─ Server Components   read via user-scoped client  ──► RLS
              ├─ Server Actions      validate (zod) → authorize → write via user client ──► RLS
              │                      (service role only for secrets / account deletion)
              ├─ /api/jobs/tick ◄── Supabase Cron (pg_cron + pg_net), shared secret
              │     └─ schedule due queries → claim jobs → adapters → relevance → ingest
              └─ after() on "Start scan" — works that scan's jobs immediately
Supabase Postgres
  ├─ auth.*            Supabase Auth (email+password, Google OAuth, email verification)
  ├─ public.*          tenant data, all RLS-protected, least-privilege grants
  └─ private.*         helper functions (not exposed by the Data API)
```

## Module boundaries (src/lib)

| Module | Rule |
|---|---|
| `domain/` | Pure TypeScript. No Next/Supabase imports. Unit-tested with `node --test`. Imports use explicit `.ts` extensions so Node can run them directly. |
| `validation/` | Zod schemas built on domain parsers. Every server action re-validates. |
| `server/` | `import "server-only"`. Session + authorization (`requireWorkspaceRole`), credential encryption, env. |
| `supabase/admin.ts` | Service-role client. Only after an explicit authorization check, always scoped by workspace id. |
| `sources/` | Pure TypeScript, no Next/Supabase imports: one adapter per public source, relevance rules, text normalization, ingest preparation. HTTP goes through an injected `SourceContext`, so every adapter is tested with deterministic fixtures. |
| `server/collection/` | Server-only glue: rate-limited HTTP context, `monitor.query` job, worker loop, scheduler tick, coverage/scan status. |
| `ai/` (M4) | Provider abstraction: `classify`, `summarize`, `embed?`, token accounting, budget checks. |

### Source adapter interface

`src/lib/sources/types.ts`:

```ts
interface SourceAdapter {                       // public, keyword-searchable sources
  id: "hackernews" | "github" | "stackexchange" | "youtube";
  configured(): { ok: true } | { ok: false; reason };     // server has the keys it needs
  rateLimit(endpoint?): RateLimitPolicy;        // shared Postgres token bucket(s)
  retentionDays?: number;                       // platform storage limits (YouTube: 30)
  searchMentions(req, ctx): Promise<{ items: CandidateMention[]; complete; incompleteReason?; rateLimit? }>;
  validateCredentials(ctx): Promise<void>;
}
interface AuthorizedSourceAdapter {             // reserved for App Store Connect, Play, Discord, GitHub App (M5–M6)
  connect(); disconnect(); validateCredentials(); fetchMention(); getIntegrationHealth();
}
```
Normalization (`normalizeHnHit`, `normalizeGithubIssue`, `normalizeSeItem`, `normalizeVideo`, `normalizeCommentThread`) is pure and exported per adapter. Rate-limit status is reported with each search result and stored in `source_health`.

### Collection pipeline

1. **Query sync** (`private.sync_monitoring_queries`, run whenever keywords change): ≤5 enabled keywords per product; one query per keyword for HN/Stack Exchange, one combined OR query for GitHub/YouTube.
2. **Schedule** (`private.schedule_due_queries`): due queries → `monitor.query` jobs, idempotency key `mq:<query>:<interval bucket>`; interval from the workspace's plan (YouTube ≥ daily).
3. **Search window:** from the query cursor minus a 2 h overlap (search indexes lag), or the scan's lookback. Overlap is safe because ingestion is idempotent.
4. **Relevance (deterministic):** whole-word keyword match → ambiguous keywords need a context term → exclusion terms veto → thread/video context alone gives a low-confidence "needs review" match. Matched terms and a 0–1 score are stored. Nothing is matched by AI yet (M4).
5. **Ingest** (`private.ingest_mentions`, atomic per batch): upsert on (product, source, external_id); re-seen items refresh engagement but never overwrite a user's relevance decision; exact duplicates (content hash, ≥60 normalized chars) and reposts (same shared link) are stored but linked to the earliest original; monthly plan limit enforced under a per-workspace row lock.
6. **Record:** coverage window (complete / partial with reason / failed), `source_health`, `api_usage_events`, query cursor.
7. **Errors:** rate limits and quotas → `defer_job` (no attempt consumed); transient → exponential backoff; auth/bad request → no retry; a dead job writes a *failed* coverage window so the gap is visible.

## Data model

Migrations: `supabase/migrations/2026101400000{1..7}_*.sql` (7 = collection: scans, rate-limit buckets, source health, scheduler, ingest).

- **Tenancy:** `profiles` (1:1 auth.users) · `workspaces` · `workspace_members(role: owner/admin/member/viewer)`. A deferred constraint trigger guarantees every workspace keeps an owner.
- **Plans & billing:** `plans` (all limits and prices are rows, not code) · `subscriptions` (written only by the server from verified webhooks) · `billing_events` (webhook idempotency) · `usage_counters`. `private.effective_plan_id` drops lapsed subscriptions to `free`.
- **Products:** `products` · `product_aliases` (kind, ambiguity flag, required context terms, negative terms) · `competitors` · `product_events` (launch markers).
- **Sources:** `integrations` (non-secret config + health) · `credential_secrets` (ciphertext only, no client access) · `ai_provider_connections` (metadata + last-4 hint) · `oauth_states` · `monitoring_queries` (query, cursor, next_run_at).
- **Jobs:** `jobs` (idempotency key, attempts, lease) · `job_runs` (history per attempt) · `job_locks` (named distributed locks) · `coverage_windows` (which time windows each source actually covered) · `api_usage_events`.
- **Mentions & analysis:** `mentions` (unique on product+source+external_id; content hash; repost link; publication and discovery time; relevance, sentiment, category with confidences) · `mention_classifications` (full history incl. manual corrections) · `feedback_clusters` + members · `daily_mention_stats` (UTC-day aggregates that all charts read) · `ai_usage_records` · `ai_investigations` (confirmed / hypotheses / assumptions + evidence) · `notification_preferences` · `notifications` (dedupe key) · `reports` · `audit_logs`.

Cross-tenant linking is structurally impossible: child tables reference `(id, workspace_id)` composite keys, so an alias, mention or cluster cannot point at another workspace's product even via the service role.

## Security model

1. **Authentication:** Supabase Auth. Sessions in httpOnly cookies via `@supabase/ssr`; `proxy.ts` refreshes them. Server code uses `auth.getUser()` (validated with Supabase), never the unverified cookie payload.
2. **Authorization, three layers:** (a) server actions call `requireWorkspaceRole(workspaceId, minRole)` and never trust ids from the client; (b) queries run as the user so Postgres RLS applies; (c) table-level grants are revoked and re-granted per table/column, so e.g. users can update `mentions.sentiment` but not `mentions.content`, and cannot read `jobs.locked_by`.
3. **Plan limits** are enforced by Postgres triggers (serialised with advisory locks), not UI checks. Triggers skip unauthorised writers so plan details aren't leaked to non-members.
4. **Secrets:** AES-256-GCM, key from `CREDENTIALS_ENCRYPTION_KEY`, workspace id bound as AAD, versioned for rotation. Stored in `credential_secrets`, which has no grants for `anon`/`authenticated`. Only the last 4 characters are ever returned.
5. **CSRF:** Server Actions only accept same-origin POSTs; OAuth uses PKCE with the verifier in an httpOnly cookie; `safeRedirectPath` blocks open redirects.
6. **Untrusted input:** website URLs reject private/loopback hosts (prevents SSRF once docs are fetched in M5). From M2, all fetched social content and repository files are treated as data in AI prompts, and AI outputs cannot trigger external actions without explicit user confirmation.
7. **Headers:** HSTS, `X-Frame-Options: DENY`, `nosniff`, strict referrer and permissions policies.
8. **Audit:** triggers record changes to workspaces, memberships, products, integrations and AI connections (never secret columns).

## Job system

- `private.enqueue_job(kind, idempotency_key, …)` — idempotent by key (e.g. `mq:<query_id>:<interval bucket>`, `scan:<scan_id>:<query_id>`).
- `private.defer_job` — postpone without consuming an attempt (rate limits are not failures).
- `private.claim_jobs(worker, limit, lease)` — `FOR UPDATE SKIP LOCKED`; reclaims jobs whose lease expired (worker crash recovery).
- `private.complete_job` / `private.fail_job` — only the lease holder may finish a job; retries use exponential backoff `30s·2^(n-1)` (max 6h) with ±20% jitter, or the source's `Retry-After`; exhausted jobs are dead-lettered.
- `private.try_acquire_lock` — named TTL locks so only one scheduler tick runs at a time.
- Trigger: Supabase Cron calls `/api/jobs/tick` every 2 minutes with `JOBS_TICK_SECRET` (constant-time compare). Each tick enqueues due `monitoring_queries` and works for ~50 s at most. Nothing depends on a browser being open. History: `job_runs` per attempt; recent runs are shown on the Integrations page.
- Server reaches private functions through `public.svc_*` wrappers executable only by `service_role`.

## Analytics principles (M3)

- Charts read `daily_mention_stats`, never raw mentions.
- Growth: `(cur − prev) / prev × 100`; when `prev = 0` the UI shows "new activity" (or "no change" when both are 0), never ∞% or a fabricated percentage.
- Spike detection uses a rolling baseline with minimum-volume thresholds so 1 → 3 mentions is not an alert.
- Every analytics view lists the sources included and marks windows where `coverage_windows` shows failed/partial monitoring as gaps, not zeros.
