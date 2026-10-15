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
| `sources/apidirect/` | Pure: API Direct client (validation, `X-API-Key`, retries, error mapping, documented billing rules), endpoint catalog, zod response schemas, normalizers, the 10 paid connectors. |
| `sources/query-optimizer.ts`, `adaptive.ts`, `expansion.ts` | Pure, deterministic engines: per-platform query grouping + fingerprints, refresh-interval decisions, comment-expansion selection. |
| `analytics/` | Pure buzz math: series with coverage gaps, growth, virality, spike detection, time zones. |
| `server/collection/` | Server-only glue: rate-limited + budget-reserving HTTP context, `monitor.query` job (shared fetches, expansion, adaptive scheduling, audits), worker loop, scheduler tick, query sync, coverage/scan status, Smart Monitoring overview. |
| `server/analytics/` | Buzz dashboard queries (RLS) and the hourly spike-detection job (service role). |
| `ai/` (M4) | Provider abstraction: `classify`, `summarize`, `embed?`, token accounting, budget checks. |

### Source adapter interface

`src/lib/sources/types.ts`:

```ts
interface SourceAdapter {                       // public, keyword-searchable sources (17 platforms)
  id: PublicSourceId;
  dataProvider?: "official" | "apidirect"; paid?: boolean; shareable?: boolean;
  streams?: StreamSpec[];                       // separate checkpoints, e.g. Reddit posts / comments;
                                                // each declares QueryCapabilities (OR syntax, length,
                                                // terms, date filter, sort, pagination, page cap)
  expandComments?(parents, ctx): Promise<SearchResult>;   // platforms without global comment search
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
Normalization is pure and exported per adapter. Rate-limit status is reported with each search result and stored in `source_health`. Paid requests go through `SourceContext.paidRequest`, which reserves budget **before** the HTTP call and must be settled with the provider's billing outcome afterwards; the API Direct client does this for every call, including retries.

### Multi-platform monitoring (Milestone 2.5)

```
keywords ──► query optimizer (per platform stream, capabilities-aware) ──► query groups + fingerprints
                                                                              │ apply_query_groups
scheduler (adaptive interval, plan floor) ──► monitor.query job ──► shared fetch (same fingerprint ⇒ one
                                                                     upstream call for every product)
   budget reservation (global → provider → platform → workspace/product/boost, advisory-locked)
   → API Direct / official API → normalize → per-product relevance → ingest (per paid request)
   → selective comment expansion → coverage window → adaptive decision → execution log
```

- **Query optimizer** (`planQueries`): OR-combines brand aliases where the platform supports OR, within length/term limits; phrases that contain a searched brand alias as a separate word are "covered"; ambiguous keywords are only searched with their context terms (platforms with grouping); category phrases get their own group; platforms without OR get one query per keyword, capped by mode (paid: eco 1 / balanced 2 / priority 4). Every keyword still drives local relevance matching, and skipped keywords are shown with the reason.
- **Shared query registry:** `monitoring_queries.fingerprint` = sha256(platform, stream, normalized expression, language, region, filters). One job fetches once (under a named lock) and ingests for every product with the same fingerprint, each with its own relevance rules; cost is split across their budgets. Results are not cached afterwards. Product-specific sources (Trustpilot, App Store) include the product in the fingerprint, so they never share.
- **Checkpoints:** `cursor.until` per query group (so per stream). Optimizer-managed groups never advance after a capped run (saturated pages or plan limit); the next run re-searches from the old checkpoint with one more page. Milestone 2 sources keep their original behaviour (advance, record the gap).
- **Adaptive engine** (`decideInterval`): intervals 1/2/3/4/6/12/24 h from recent activity, growth, spikes, saturation, audit misses, platform importance, cost (eco) and mode; bounded by mode, the plan floor (a Launch Boost may go down to the plan's boost minimum) and source limits (YouTube 24 h). Safety: never above 24 h; lengthens at most one step per decision and not at all with low coverage confidence; failures schedule a quicker recovery run; weekly (eco: fortnightly for paid) completeness audits re-search 7 days and count what regular checks missed. Every decision stores human-readable reasons.
- **Comment expansion** (`selectExpansions`): relevant parent posts scored by relevance × log(comments) × recency; revisited only when the discussion grew; ≤1/2/4 parents per run by mode, one page each; cost tracked under its own purpose.
- **Cost control:** `provider_pricing` is the only price list. `reserve_api_spend` checks the global budget (no row ⇒ no paid calls), provider, platform, then each member's workspace allowance (plan allowance, optionally lowered), product budget and boost cap; members who can't pay are dropped. `settle_api_spend` applies the documented billing rules (answered = billed, including zero results; `pages=N` bills N; unanswered requests stay counted at their estimate as `unknown`). `billing_reconciliations` records invoices against the ledger.

### Collection pipeline

1. **Query sync** (`private.sync_monitoring_queries`, run whenever keywords change): ≤5 enabled keywords per product; one query per keyword for HN/Stack Exchange, one combined OR query for GitHub/YouTube.
2. **Schedule** (`private.schedule_due_queries`): due queries → `monitor.query` jobs, idempotency key `mq:<query>:<interval bucket>`; interval from the workspace's plan (YouTube ≥ daily).
3. **Search window:** from the query cursor minus a 2 h overlap (search indexes lag), or the scan's lookback. Overlap is safe because ingestion is idempotent.
4. **Relevance (deterministic):** whole-word keyword match → ambiguous keywords need a context term → exclusion terms veto → thread/video context alone gives a low-confidence "needs review" match. Matched terms and a 0–1 score are stored. Nothing is matched by AI yet (M4).
5. **Ingest** (`private.ingest_mentions`, atomic per batch): upsert on (product, source, external_id); re-seen items refresh engagement but never overwrite a user's relevance decision; exact duplicates (content hash, ≥60 normalized chars) and reposts (same shared link) are stored but linked to the earliest original; monthly plan limit enforced under a per-workspace row lock.
6. **Record:** coverage window (complete / partial with reason / failed), `source_health`, `api_usage_events`, query cursor.
7. **Errors:** rate limits and quotas → `defer_job` (no attempt consumed); transient → exponential backoff; auth/bad request → no retry; a dead job writes a *failed* coverage window so the gap is visible.

## Data model

Migrations: `supabase/migrations/2026101400000{1..7}_*.sql` (7 = collection: scans, rate-limit buckets, source health, scheduler, ingest) and `202610150000{01..03}` (M2.5 platforms; monitoring v2 + cost control; M3 analytics functions). All additive.

- **Tenancy:** `profiles` (1:1 auth.users) · `workspaces` · `workspace_members(role: owner/admin/member/viewer)`. A deferred constraint trigger guarantees every workspace keeps an owner.
- **Plans & billing:** `plans` (all limits and prices are rows, not code) · `subscriptions` (written only by the server from verified webhooks) · `billing_events` (webhook idempotency) · `usage_counters`. `private.effective_plan_id` drops lapsed subscriptions to `free`.
- **Products:** `products` · `product_aliases` (kind, ambiguity flag, required context terms, negative terms) · `competitors` · `product_events` (launch markers).
- **Sources:** `integrations` (non-secret config + health) · `credential_secrets` (ciphertext only, no client access) · `ai_provider_connections` (metadata + last-4 hint) · `oauth_states` · `monitoring_queries` (query, cursor, next_run_at).
- **Jobs:** `jobs` (idempotency key, attempts, lease) · `job_runs` (history per attempt) · `job_locks` (named distributed locks) · `coverage_windows` (which time windows each source actually covered) · `api_usage_events`.
- **Monitoring (M2.5):** `product_source_settings` · `launch_boosts` · `monitoring_executions` (per-run log incl. interval decision and reasons, no prices) · `comment_expansions` · service-only `provider_pricing`, `plan_paid_allowances`, `api_budgets`, `api_cost_ledger`, `api_cost_allocations`, `billing_reconciliations`.
- **Mentions & analysis:** `mentions` (unique on product+source+external_id; content hash; repost link; publication and discovery time; mention type, collection method, data provider, community, link target, estimated-date flag; relevance, sentiment, category with confidences) · `buzz_spikes` · `mention_classifications` (full history incl. manual corrections) · `feedback_clusters` + members · `daily_mention_stats` (UTC-day aggregates that all charts read) · `ai_usage_records` · `ai_investigations` (confirmed / hypotheses / assumptions + evidence) · `notification_preferences` · `notifications` (dedupe key) · `reports` · `audit_logs`.

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

## Analytics (M3)

- **Live SQL, caller's RLS:** `buzz_series` (per bucket × platform: relevant / irrelevant / pending, posts / comments, engagement), `buzz_totals` (per platform, incl. distinct authors, excluded duplicates, undated rows) and `buzz_coverage` (share of each bucket covered by complete / partial windows, merged with `range_agg`) are `SECURITY INVOKER`, so users can only aggregate their own workspace. Day buckets follow the viewer's IANA time zone (cookie set by the browser). `daily_mention_stats` (UTC) is not used: it can't follow time zones.
- **Counting rules:** originals only (exact duplicates and reposts excluded); publication time, not discovery time; rows with no publication date (web results) stay out of time series and are counted separately; late-arriving mentions update past periods.
- **Gaps:** a platform's bucket is *measured* when monitoring covered ≥50% of it (or it has data); otherwise it is `null`. Unmonitored buckets render grey ("not monitored"), never zero. Partially monitored buckets are flagged.
- **Growth:** `(cur − prev) / prev`; prev = 0 ⇒ "New activity"; previous period essentially unmonitored ⇒ "No earlier data to compare"; either period < 90% completely monitored ⇒ flagged "incomplete data".
- **Virality (experimental, 0–100):** mention growth vs the product's own 28-day baseline (35%), distinct-author growth (20%), engagement per mention (15%), platform spread (15%), acceleration vs the previous day (15%); ratios on a log scale with pseudo-counts, then damped by volume (n/(n+5)) so 1 → 3 isn't viral and size alone never scores. Uses only platforms completely monitored over the baseline. Not sentiment.
- **Spikes:** rolling 28-day (daily) / 7-day (hourly) baseline of *completely monitored* periods: median + MAD (Poisson floor), and the value must also beat 1.2 × the 90th percentile; minimum counts 8/day, 6/hour. Stored idempotently in `buzz_spikes` by the hourly tick, with a slot for a later AI explanation.