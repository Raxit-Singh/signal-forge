import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { SourceError } from "@/lib/sources/errors";
import { MonitorJobError, recordCoverage, recordHealth, runMonitorQuery, type JobRow } from "./monitor";
import { configuredSourceIds, getAdapters, sourceSetup } from "./sources";
import { syncAllProducts } from "./query-sync";
import { detectSpikesForActiveProducts } from "../analytics/spikes";

const LEASE_SECONDS = 180;
const CLAIM_BATCH = 4;
/** Stop claiming new work this long before the budget ends; an in-flight job may still need it. */
const SAFETY_MARGIN_MS = 15_000;
/** Longest a rate-limited job is postponed in one step. */
const MAX_DEFER_SECONDS = 26 * 3600;

export interface WorkerSummary {
  worker: string;
  claimed: number;
  succeeded: number;
  deferred: number;
  failed: number;
  dead: number;
}

class PermanentJobError extends Error {}

async function processJob(admin: SupabaseClient, job: JobRow, worker: string, summary: WorkerSummary) {
  const started = Date.now();
  try {
    let result: unknown;
    if (job.kind === "monitor.query") result = await runMonitorQuery(admin, job, getAdapters());
    else throw new PermanentJobError(`Unknown job kind: ${job.kind}`);
    const { data: ok } = await admin.rpc("svc_complete_job", {
      p_job_id: job.id, p_worker: worker, p_result: result, p_metrics: { ms: Date.now() - started },
    });
    if (ok) summary.succeeded++;
  } catch (e) {
    const cause = e instanceof MonitorJobError ? e.cause : e;
    const message = (cause instanceof Error ? cause.message : String(cause)).slice(0, 1000);

    // Rate limits and quotas are expected: postpone without spending an attempt.
    // (Budget refusals are not retried: the window is recorded as a gap and the schedule moves on.)
    if (cause instanceof SourceError && (cause.kind === "rate_limited" || cause.kind === "quota")) {
      const seconds = Math.min(MAX_DEFER_SECONDS, Math.max(5, cause.retryAfterSeconds ?? 60));
      const { data: ok } = await admin.rpc("svc_defer_job", { p_job_id: job.id, p_worker: worker, p_seconds: seconds, p_reason: message });
      if (ok) summary.deferred++;
      return;
    }

    const retryable = cause instanceof SourceError ? cause.retryable : !(cause instanceof PermanentJobError);
    const { data: status } = await admin.rpc("svc_fail_job", {
      p_job_id: job.id, p_worker: worker, p_error: message, p_retryable: retryable,
      p_retry_after_seconds: cause instanceof SourceError ? cause.retryAfterSeconds ?? null : null,
    });
    summary.failed++;
    if (status === "dead") {
      summary.dead++;
      // The window was never collected: record the gap so analytics show incomplete coverage.
      if (e instanceof MonitorJobError && e.provider && e.window && e.query) {
        await recordCoverage(admin, e.query, e.provider, e.window, "failed", message, job.id);
      }
    }
    console.error(`[worker] job ${job.id} (${job.kind}) attempt ${job.attempts} failed: ${message}`);
  }
}

/**
 * Claims and runs jobs until the time budget is used. Safe to run many
 * workers at once: claims use SKIP LOCKED leases, completion is checked
 * against the lease holder, and every job is idempotent.
 */
export async function runWorker(opts: { budgetMs: number; scanId?: string; admin?: SupabaseClient }): Promise<WorkerSummary> {
  const admin = opts.admin ?? createAdminClient();
  const worker = `w-${randomUUID().slice(0, 8)}`;
  const deadline = Date.now() + opts.budgetMs - SAFETY_MARGIN_MS;
  const summary: WorkerSummary = { worker, claimed: 0, succeeded: 0, deferred: 0, failed: 0, dead: 0 };

  while (Date.now() < deadline) {
    const { data: jobs, error } = await admin.rpc("svc_claim_jobs", {
      p_worker: worker, p_limit: CLAIM_BATCH, p_lease_seconds: LEASE_SECONDS, p_kinds: null, p_scan_id: opts.scanId ?? null,
    });
    if (error) {
      console.error(`[worker] claim failed: ${error.message}`);
      break;
    }
    const batch = (jobs ?? []) as JobRow[];
    if (batch.length === 0) break;
    summary.claimed += batch.length;
    // Different sources have independent rate limits, so a small batch runs concurrently.
    await Promise.all(batch.map((j) => processJob(admin, j, worker, summary)));
  }
  return summary;
}

export interface TickSummary {
  scheduled: number;
  purged: number | null;
  synced: number | null;
  spikes: number | null;
  worker: WorkerSummary;
}

/** One scheduler tick: enqueue due queries, daily maintenance, then work the queue. */
export async function tick(budgetMs: number): Promise<TickSummary> {
  const admin = createAdminClient();
  const holder = `tick-${randomUUID().slice(0, 8)}`;
  let scheduled = 0;
  let purged: number | null = null;
  let synced: number | null = null;
  let spikes: number | null = null;

  const { data: gotScheduler } = await admin.rpc("svc_try_acquire_lock", { p_name: "scheduler", p_holder: holder, p_ttl_seconds: 50 });
  if (gotScheduler) {
    try {
      const { data, error } = await admin.rpc("svc_schedule_due_queries", { p_providers: configuredSourceIds(), p_limit: 500 });
      if (error) console.error(`[tick] schedule failed: ${error.message}`);
      scheduled = Number(data ?? 0);

      // Once a day (the lock is deliberately not released): retention purge + health for unconfigured sources.
      const { data: daily } = await admin.rpc("svc_try_acquire_lock", { p_name: "maintenance:daily", p_holder: holder, p_ttl_seconds: 23 * 3600 });
      if (daily) {
        const { data: n } = await admin.rpc("svc_purge_expired_mentions", { p_limit: 5000 });
        purged = Number(n ?? 0);
        for (const s of sourceSetup()) {
          if (!s.configured) await recordHealth(admin, s.id, { status: "not_configured", error: s.reason });
        }
        // Query groups follow server config / plan changes even when nobody edits keywords.
        synced = await syncAllProducts(admin);
      }

      // Hourly: spike detection for products with recent mentions.
      const { data: hourly } = await admin.rpc("svc_try_acquire_lock", { p_name: "analytics:spikes", p_holder: holder, p_ttl_seconds: 55 * 60 });
      if (hourly) spikes = await detectSpikesForActiveProducts(admin);
    } finally {
      await admin.rpc("svc_release_lock", { p_name: "scheduler", p_holder: holder });
    }
  }

  const worker = await runWorker({ budgetMs, admin });
  return { scheduled, purged, synced, spikes, worker };
}
