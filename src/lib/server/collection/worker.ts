import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { SourceError } from "@/lib/sources/errors";
import { MonitorJobError, recordCoverage, recordHealth, runMonitorQuery, type JobRow } from "./monitor";
import { configuredSourceIds, getAdapters, sourceSetup } from "./sources";
import { syncAllProducts } from "./query-sync";
import { detectSpikesForActiveProducts } from "../analytics/spikes";
import { refreshActivityForActiveProducts } from "./activity";
import { runBackfillTask } from "./backfill";
import { AiError } from "@/lib/ai/types";
import { classifyProduct, productsAwaitingClassification } from "../ai/classify";
import { generateWeeklyReports } from "../reports/generate";
import { reclusterProduct } from "../ai/clusters";
import { runInvestigation } from "../ai/investigate";
import { workspaceAvailability } from "../ai/gateway";
import { expireStaleTasks } from "../agent/tasks";

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
    else if (job.kind === "backfill.task") result = await runBackfillTask(admin, job, getAdapters());
    else if (job.kind === "ai.classify") {
      const productId = String(job.payload?.product_id ?? "");
      const classified = await classifyProduct(admin, productId);
      if (classified.status !== "done") console.warn(`[worker] job ${job.id} (ai.classify) stopped: ${classified.status}${classified.message ? ` — ${classified.message}` : ""}`);
      // Issues are recomputed from stored labels (free, deterministic) after every batch.
      const clusters = classified.classified > 0 ? await reclusterProduct(admin, productId) : null;
      result = { ...classified, clusters };
    } else if (job.kind === "ai.investigate") result = await runInvestigation(admin, String(job.payload?.investigation_id ?? ""));
    else throw new PermanentJobError(`Unknown job kind: ${job.kind}`);
    const { data: ok } = await admin.rpc("svc_complete_job", {
      p_job_id: job.id, p_worker: worker, p_result: result, p_metrics: { ms: Date.now() - started },
    });
    if (ok) summary.succeeded++;
  } catch (e) {
    const cause = e instanceof MonitorJobError ? e.cause : e;
    const message = (cause instanceof Error ? cause.message : String(cause)).slice(0, 1000);

    // AI provider rate limits: postpone. Outages: retry. Anything else (bad output, refusals): give up on this job.
    if (cause instanceof AiError) {
      if (cause.kind === "rate_limited") {
        const seconds = Math.min(MAX_DEFER_SECONDS, Math.max(5, cause.retryAfterSeconds ?? 60));
        const { data: ok } = await admin.rpc("svc_defer_job", { p_job_id: job.id, p_worker: worker, p_seconds: seconds, p_reason: message });
        if (ok) summary.deferred++;
        return;
      }
      await admin.rpc("svc_fail_job", { p_job_id: job.id, p_worker: worker, p_error: message, p_retryable: cause.retryable, p_retry_after_seconds: cause.retryAfterSeconds });
      summary.failed++;
      console.error(`[worker] job ${job.id} (${job.kind}) AI ${cause.kind}: ${message}`);
      return;
    }

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
export async function runWorker(opts: { budgetMs: number; scanId?: string; kinds?: string[]; admin?: SupabaseClient }): Promise<WorkerSummary> {
  const admin = opts.admin ?? createAdminClient();
  const worker = `w-${randomUUID().slice(0, 8)}`;
  const deadline = Date.now() + opts.budgetMs - SAFETY_MARGIN_MS;
  const summary: WorkerSummary = { worker, claimed: 0, succeeded: 0, deferred: 0, failed: 0, dead: 0 };

  while (Date.now() < deadline) {
    const { data: jobs, error } = await admin.rpc("svc_claim_jobs", {
      p_worker: worker, p_limit: CLAIM_BATCH, p_lease_seconds: LEASE_SECONDS, p_kinds: opts.kinds ?? null, p_scan_id: opts.scanId ?? null,
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
  ranked: number | null;
  ai: number | null;
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
  let ranked: number | null = null;
  let ai: number | null = null;

  const { data: gotScheduler } = await admin.rpc("svc_try_acquire_lock", { p_name: "scheduler", p_holder: holder, p_ttl_seconds: 50 });
  if (gotScheduler) {
    try {
      const { data, error } = await admin.rpc("svc_schedule_due_queries", { p_providers: configuredSourceIds(), p_limit: 500 });
      if (error) console.error(`[tick] schedule failed: ${error.message}`);
      scheduled = Number(data ?? 0);
      // Historical searches: due backfill steps (paused ones resume when allowance/budget allows).
      const { data: bf, error: bfErr } = await admin.rpc("svc_schedule_backfills", { p_providers: configuredSourceIds(), p_limit: 200 });
      if (bfErr) console.error(`[tick] backfill schedule failed: ${bfErr.message}`);
      scheduled += Number(bf ?? 0);

      // Once a day (the lock is deliberately not released): retention purge + health for unconfigured sources.
      const { data: daily } = await admin.rpc("svc_try_acquire_lock", { p_name: "maintenance:daily", p_holder: holder, p_ttl_seconds: 23 * 3600 });
      if (daily) {
        const { data: n } = await admin.rpc("svc_purge_expired_mentions", { p_limit: 5000 });
        purged = Number(n ?? 0);
        await admin.rpc("svc_purge_workspace_events");
        await admin.rpc("svc_ai_purge_cache");
        await admin.rpc("svc_purge_email_log");
        for (const s of sourceSetup()) {
          if (!s.configured) await recordHealth(admin, s.id, { status: "not_configured", error: s.reason });
        }
        // Query groups follow server config / plan changes even when nobody edits keywords.
        synced = await syncAllProducts(admin);
        // Last week's report for every product that doesn't have one (from stored data; no API or AI calls).
        const reports = await generateWeeklyReports(admin).catch((e) => {
          console.error(`[tick] weekly reports failed: ${e instanceof Error ? e.message : e}`);
          return 0;
        });
        if (reports) console.log(`[tick] generated ${reports} weekly report(s)`);
      }

      // Hourly: spike detection for products with recent mentions, then platform activity
      // ranking from stored data (spikes feed the ranking; no API calls).
      const { data: hourly } = await admin.rpc("svc_try_acquire_lock", { p_name: "analytics:spikes", p_holder: holder, p_ttl_seconds: 55 * 60 });
      if (hourly) {
        spikes = await detectSpikesForActiveProducts(admin);
        ranked = await refreshActivityForActiveProducts(admin);
      }

      // Every 5 minutes: classification jobs for products with new mentions, only in
      // workspaces whose AI provider can run (nothing is queued while AI is off).
      const { data: aiTurn } = await admin.rpc("svc_try_acquire_lock", { p_name: "ai:classify", p_holder: holder, p_ttl_seconds: 5 * 60 - 10 });
      if (aiTurn) {
        ai = await scheduleClassification(admin);
        // Developer-agent tasks whose Claude session never reported back.
        await expireStaleTasks(admin);
      }
    } finally {
      await admin.rpc("svc_release_lock", { p_name: "scheduler", p_holder: holder });
    }
  }

  const worker = await runWorker({ budgetMs, admin });
  return { scheduled, purged, synced, spikes, ranked, ai, worker };
}

async function scheduleClassification(admin: SupabaseClient): Promise<number> {
  const bucket = Math.floor(Date.now() / (5 * 60_000));
  const ready = new Map<string, boolean>();
  let n = 0;
  for (const { productId, workspaceId } of await productsAwaitingClassification(admin)) {
    if (!ready.has(workspaceId)) ready.set(workspaceId, (await workspaceAvailability(admin, workspaceId)).ok);
    if (!ready.get(workspaceId)) continue;
    const { error } = await admin.rpc("svc_enqueue_job", {
      p_kind: "ai.classify", p_idempotency_key: `ai.classify:${productId}:${bucket}`, p_payload: { product_id: productId },
      p_workspace_id: workspaceId, p_product_id: productId, p_run_after: new Date().toISOString(), p_priority: 120,
    });
    if (error) console.error(`[tick] ai enqueue failed: ${error.message}`);
    else n++;
  }
  return n;
}
