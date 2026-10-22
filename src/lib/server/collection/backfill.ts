import "server-only";
import { NEVER, scanStopped } from "./scan-pause";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pagesToRequest, relevantShare, upperRate } from "@/lib/sources/arrival";
import { collectionProfile } from "@/lib/sources/collection-profile";
import { planBackfillTasks, runStatus, type TaskCursor, type TaskStatus } from "@/lib/sources/backfill-plan";
import { SourceError } from "@/lib/sources/errors";
import { appStoreIds } from "@/lib/sources/official";
import { isLegacySource, isPublicSource, streamsOf } from "@/lib/sources/registry";
import { decideResume, observedSpanMinutes } from "@/lib/sources/resume";
import type { PublicSourceId, SearchWindow, SourceAdapter } from "@/lib/sources/types";
import type { HistoryMode } from "@/lib/domain/history";
import { estimateFromRow } from "./activity";
import { createSourceContext, type PaidCall, type UsageEvent } from "./context";
import { emitEvent, ingestForBackfill, readSince, recordCoverage, recordHealth, searchWithEscalation, type JobRow } from "./monitor";
import { getAdapters, paidCollectionEnabled } from "./sources";
import { websiteDomain } from "./query-sync";

// Historical backfill: separate from ongoing monitoring. One task per query group
// walks its requested window back in bounded, resumable jobs (date-range
// splitting or page offsets, per the source's collection profile). Progress is
// persisted after every job; an interrupted job resumes from the stored cursor.
// Historical and new mentions draw on the same allowance; when it runs out the
// task pauses (keeping what it found) and resumes when the period renews.

const CONTINUE_AFTER_MS = 20_000;
const MAX_FAILURES = 5;

/** Creates a historical search for a product (or returns the one already running). */
export async function startBackfill(admin: SupabaseClient, i: {
  productId: string; workspaceId: string; userId: string | null; mode: HistoryMode; start: Date; end: Date;
}): Promise<{ runId: string; existing: boolean }> {
  const { data: active } = await admin.from("backfill_runs").select("id")
    .eq("product_id", i.productId).in("status", ["queued", "searching", "paused"]).limit(1).maybeSingle();
  if (active) return { runId: active.id as string, existing: true };

  const { data: queries, error: qErr } = await admin.from("monitoring_queries").select("id, provider, stream")
    .eq("product_id", i.productId).eq("enabled", true).is("competitor_id", null);
  if (qErr) throw new Error(`Couldn't load searches (${qErr.code ?? "db"})`);
  const tasks = planBackfillTasks(queries ?? [], { start: i.start, end: i.end }, getAdapters(), { now: new Date(), paidEnabled: paidCollectionEnabled() });

  const { data: run, error } = await admin.from("backfill_runs").insert({
    workspace_id: i.workspaceId, product_id: i.productId, requested_by: i.userId, mode: i.mode,
    range_start: i.start.toISOString(), range_end: i.end.toISOString(), status: runStatus(tasks),
  }).select("id").single();
  if (error || !run) throw new Error(`Couldn't create the historical search (${error?.code ?? "db"})`);
  if (tasks.length) {
    const { error: tErr } = await admin.from("backfill_tasks").insert(tasks.map((t) => ({
      ...t, run_id: run.id, workspace_id: i.workspaceId, product_id: i.productId,
      completed_at: t.status === "unavailable" ? new Date().toISOString() : null,
    })));
    if (tErr) throw new Error(`Couldn't create the historical search tasks (${tErr.code ?? "db"})`);
  }
  await admin.from("products").update({ history_mode: i.mode, history_start: i.start.toISOString() }).eq("id", i.productId);
  await emitEvent(admin, i.workspaceId, i.productId, "backfill", { status: "started" });
  return { runId: run.id as string, existing: false };
}

interface TaskRow {
  id: string; run_id: string; workspace_id: string; product_id: string; query_id: string | null;
  platform: string; stream: string; status: TaskStatus; cursor: TaskCursor | null;
  jobs_run: number; pages: number; results: number; inserted: number; paid_requests: number; consecutive_failures: number;
}

/** Pages the first job of a history task may buy on a page-billed source. */
const FIRST_JOB_PAGES = 2;

const TASK_COLUMNS = "id, run_id, workspace_id, product_id, query_id, platform, stream, status, cursor, jobs_run, pages, results, inserted, paid_requests, consecutive_failures";

async function refreshRun(admin: SupabaseClient, runId: string) {
  const { data: tasks } = await admin.from("backfill_tasks").select("status, note").eq("run_id", runId);
  const list = (tasks ?? []) as Array<{ status: TaskStatus; note: string | null }>;
  const status = runStatus(list);
  const done = status === "completed" || status === "partial" || status === "unavailable";
  const pauseReason = status === "paused" ? list.find((t) => t.status === "paused" && t.note)?.note?.slice(0, 300) ?? null : null;
  await admin.from("backfill_runs").update({
    status, pause_reason: pauseReason, ...(done ? { completed_at: new Date().toISOString() } : {}),
  }).eq("id", runId).neq("status", "canceled");
}

export interface BackfillResult {
  taskId: string;
  status: TaskStatus;
  inserted?: number;
  fetched?: number;
  pages?: number;
  gapLeft?: boolean;
  skipped?: string;
}

/** One bounded step of a backfill task (job kind "backfill.task"). */
export async function runBackfillTask(admin: SupabaseClient, job: JobRow, adapters: Record<PublicSourceId, SourceAdapter>): Promise<BackfillResult> {
  const taskId = String(job.payload.task_id ?? "");
  const { data: t } = await admin.from("backfill_tasks").select(TASK_COLUMNS).eq("id", taskId).maybeSingle<TaskRow>();
  if (!t) return { taskId, status: "unavailable", skipped: "task_missing" };
  if (!["queued", "searching", "paused"].includes(t.status) || !t.cursor || !isPublicSource(t.platform)) {
    return { taskId, status: t.status, skipped: "not_runnable" };
  }
  const provider = t.platform;
  const adapter = adapters[provider];
  const finish = async (patch: Record<string, unknown>, status: TaskStatus) => {
    await admin.from("backfill_tasks").update({ ...patch, status }).eq("id", t.id);
    await refreshRun(admin, t.run_id);
  };
  if (await scanStopped(admin, t.product_id)) {
    await finish({ next_run_at: NEVER, note: "Stopped with Stop scan; what was collected is kept." }, "partial");
    return { taskId, status: "partial", skipped: "scan_stopped" };
  }

  const { data: q } = t.query_id
    ? await admin.from("monitoring_queries").select("id, workspace_id, product_id, provider, stream, query, params, managed_by, enabled").eq("id", t.query_id).maybeSingle()
    : { data: null };
  if (!q || !q.enabled) {
    await finish({ cursor: null, note: "This search was turned off or replaced (keywords changed); history for it was not collected.", completed_at: new Date().toISOString() }, "partial");
    return { taskId, status: "partial", skipped: "query_disabled" };
  }
  const { data: ctx } = await admin.rpc("svc_schedule_context", { p_product_id: t.product_id, p_platform: provider });
  const c = ctx as { name: string; website_url: string | null; app_store_url: string | null; archived: boolean } | null;
  if (!c || c.archived) {
    await finish({ cursor: null, note: "Product archived.", completed_at: new Date().toISOString() }, "partial");
    return { taskId, status: "partial", skipped: "product_archived" };
  }
  if (!adapter.configured().ok || (adapter.paid && !paidCollectionEnabled())) {
    await finish({ next_run_at: new Date(Date.now() + 6 * 3_600_000).toISOString(), note: adapter.paid ? "Waiting: paid sources are switched off on this server." : "Waiting: this source isn't configured." }, "paused");
    return { taskId, status: "paused", skipped: "not_configured" };
  }

  const window: SearchWindow = { since: new Date(t.cursor.since), until: new Date(t.cursor.until) };
  const scope = { workspace_id: t.workspace_id, product_id: t.product_id };
  const stream = streamsOf(adapter).find((s) => s.id === t.stream) ?? streamsOf(adapter)[0]!;
  const profile = collectionProfile(provider, stream.id);
  const { data: est } = await admin.from("arrival_estimates")
    .select("query_id, raw_alpha, raw_beta, rel_alpha, rel_beta, observations, saturations, exposure_hours, last_observed_at")
    .eq("query_id", q.id).maybeSingle();
  const estimate = estimateFromRow(est ?? undefined);
  const capPages = Math.max(1, Math.min(stream.capabilities.maxPagesPerRun, profile.maxPagesPerJob, isLegacySource(provider) ? 5 : 10));
  // A history window is long, so the rate model asks for many pages at once; on a page-billed
  // source every requested page is paid even when it comes back empty (Facebook: 7 pages for
  // 5 results). The first job of a task reads 2 pages and escalates only if they come back full;
  // later jobs continue from what that showed.
  const planned = profile.billing === "pages"
    ? pagesToRequest({ ratePerHour: upperRate(estimate.raw), windowMinutes: (window.until.getTime() - window.since.getTime()) / 60_000, perPage: profile.perPage, maxPages: capPages, billing: "pages", learning: estimate.observations === 0, relevantShare: relevantShare(estimate) })
    : capPages;
  const maxPages = profile.billing === "pages" && t.jobs_run === 0 ? Math.min(planned, FIRST_JOB_PAGES) : planned;

  const usage: UsageEvent[] = [];
  const paidCalls: PaidCall[] = [];
  const sctx = createSourceContext(admin, provider, (endpoint) => adapter.rateLimit(endpoint), usage,
    { members: [{ workspace_id: t.workspace_id, product_id: t.product_id, boost_id: null }], jobId: job.id, fingerprint: null }, paidCalls);
  const started = new Date();
  try {
    const terms = ((q.params as { terms?: string[] } | null)?.terms ?? []).filter((x) => typeof x === "string" && x.trim()).slice(0, 10);
    const app = appStoreIds(c.app_store_url);
    const search = await searchWithEscalation(adapter, {
      terms: terms.length ? terms : [c.name], window, maxPages, startPage: t.cursor.page,
      stream: q.stream === "default" ? undefined : q.stream,
      query: q.managed_by === "optimizer" ? (q.query as string) : undefined,
      target: { websiteDomain: websiteDomain(c.website_url), appStoreId: app?.id ?? null, appStoreCountry: app?.country ?? null },
    }, sctx, profile, capPages);
    if (search.saturated === undefined && !search.complete) search.saturated = true;

    const ing = await ingestForBackfill(admin, provider, adapter, t.product_id, search.items, new Date());
    const overLimit = ing.overLimit > 0;
    const resume = decideResume({
      profile, window, items: search.items, saturated: Boolean(search.saturated),
      pagesRead: search.pagesRequested ?? maxPages, previous: t.cursor, platformName: adapter.name,
    });
    const readFrom = readSince(window, resume, search.items);
    const inherentReason = !search.saturated && !search.complete ? search.incompleteReason ?? "This source can't guarantee complete results." : null;
    await recordCoverage(admin, scope, provider, { since: readFrom, until: window.until }, overLimit || inherentReason ? "partial" : "complete",
      overLimit ? "Mention allowance used up: further mentions were held, not delivered." : inherentReason, job.id);
    if (resume.lost) await recordCoverage(admin, scope, provider, { since: resume.lost.since, until: resume.lost.until }, "partial", resume.lost.reason, job.id);

    const counters = {
      jobs_run: t.jobs_run + 1, pages: t.pages + (search.pagesRequested ?? maxPages), results: t.results + search.items.length,
      inserted: t.inserted + ing.inserted, paid_requests: t.paid_requests + paidCalls.length, consecutive_failures: 0, last_error: null,
    };
    let status: TaskStatus;
    let patch: Record<string, unknown>;
    if (overLimit) {
      // Keep the cursor: the held part is searched again when the allowance renews.
      status = "paused";
      patch = { ...counters, next_run_at: new Date(Date.now() + 5 * 60_000).toISOString(), note: "Paused: the mention allowance is used up. Mentions found so far are kept." };
    } else if (resume.gap) {
      status = "searching";
      patch = { ...counters, cursor: resume.gap, next_run_at: new Date(Date.now() + CONTINUE_AFTER_MS).toISOString(), note: resume.lost?.reason ?? null };
    } else {
      status = resume.lost || inherentReason ? "partial" : "completed";
      patch = { ...counters, cursor: null, completed_at: new Date().toISOString(), note: resume.lost?.reason ?? inherentReason };
    }
    await admin.from("backfill_tasks").update({ ...patch, status }).eq("id", t.id);
    await refreshRun(admin, t.run_id);
    if (status === "searching") {
      await admin.rpc("svc_enqueue_job", {
        p_kind: "backfill.task", p_idempotency_key: `bf:${t.id}:${counters.jobs_run}:0`, p_payload: { task_id: t.id },
        p_workspace_id: t.workspace_id, p_product_id: t.product_id, p_run_after: new Date(Date.now() + CONTINUE_AFTER_MS).toISOString(), p_priority: 120,
      });
    }
    await admin.from("monitoring_executions").insert({
      workspace_id: t.workspace_id, product_id: t.product_id, query_id: q.id, job_id: job.id, platform: provider, stream: q.stream,
      status: status === "completed" || status === "searching" ? "succeeded" : "partial", started_at: started.toISOString(),
      window_start: window.since.toISOString(), window_end: window.until.toISOString(), pages_requested: search.pagesRequested ?? maxPages,
      items_fetched: search.items.length, items_relevant: ing.relevant, inserted: ing.inserted, duplicates: ing.duplicates,
      saturated: Boolean(search.saturated), paid_requests: paidCalls.length, observed_span_minutes: observedSpanMinutes(search.items, window),
      backfill_task_id: t.id, interval_reasons: [], detail: `Historical search${resume.lost ? `: ${resume.lost.reason}` : ""}`.slice(0, 500),
    });
    await recordHealth(admin, provider, { status: "ok" });
    if (ing.inserted > 0) await emitEvent(admin, t.workspace_id, t.product_id, "mentions", { inserted: ing.inserted, platform: provider, backfill: true });
    await emitEvent(admin, t.workspace_id, t.product_id, "backfill", { status });
    return { taskId, status, inserted: ing.inserted, fetched: search.items.length, pages: search.pagesRequested ?? maxPages, gapLeft: Boolean(resume.gap) };
  } catch (e) {
    const err = e instanceof SourceError ? e : new SourceError("transient", e instanceof Error ? e.message : "Unknown error");
    if (err.kind === "rate_limited" || err.kind === "quota") throw err; // the worker defers without spending an attempt
    const failures = t.consecutive_failures + 1;
    const budget = err.kind === "budget";
    // A rejected request ("not found", invalid search) gives the same answer every time and
    // paid sources bill it: stop at once instead of buying it MAX_FAILURES times.
    const permanent = err.kind === "bad_request" || err.kind === "auth";
    const giveUp = !budget && (permanent || failures >= MAX_FAILURES);
    await admin.from("backfill_tasks").update({
      consecutive_failures: failures, last_error: err.message.slice(0, 500),
      status: budget ? "paused" : giveUp ? "partial" : t.status === "paused" ? "searching" : t.status,
      note: budget ? "Paused: the paid-source budget is used up. It resumes when the budget allows." : giveUp ? (permanent ? `${adapter.name} rejected this search (${err.message.slice(0, 120)}); nothing more to collect here.` : `Stopped after ${failures} failed attempts; the rest of the window was not collected.`) : null,
      next_run_at: new Date(Date.now() + (budget ? 6 * 3_600_000 : Math.min(3_600_000, 60_000 * 2 ** failures))).toISOString(),
      ...(giveUp ? { cursor: null, completed_at: new Date().toISOString() } : {}),
    }).eq("id", t.id);
    if (giveUp) await recordCoverage(admin, scope, provider, window, "failed", err.message, job.id);
    await refreshRun(admin, t.run_id);
    await emitEvent(admin, t.workspace_id, t.product_id, "backfill", { status: "error" });
    return { taskId, status: budget ? "paused" : giveUp ? "partial" : "searching" };
  } finally {
    if (usage.length > 0) await admin.from("api_usage_events").insert(usage.map((u) => ({ ...u, workspace_id: t.workspace_id })));
  }
}
