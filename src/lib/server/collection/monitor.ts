import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SourceError } from "@/lib/sources/errors";
import { prepareIngest } from "@/lib/sources/pipeline";
import { isPublicSource } from "@/lib/sources/registry";
import type { AliasRule } from "@/lib/sources/relevance";
import type { PublicSourceId, SearchWindow, SourceAdapter } from "@/lib/sources/types";
import { createSourceContext, type UsageEvent } from "./context";

/** Re-scan this much before the last covered moment: search indexes lag behind publication. */
const OVERLAP_MS = 2 * 3_600_000;
/** First scheduled run without a scan looks back this far. */
const FIRST_RUN_LOOKBACK_MS = 24 * 3_600_000;
const MAX_LOOKBACK_MS = 90 * 86_400_000;
const DEFAULT_MAX_PAGES = 2;
const INGEST_CHUNK = 250;

export interface JobRow {
  id: string;
  kind: string;
  workspace_id: string | null;
  product_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  scan_id: string | null;
}

export interface MonitorResult {
  provider: PublicSourceId;
  skipped?: "query_disabled" | "product_archived" | "not_configured";
  windowStart?: string;
  windowEnd?: string;
  fetched?: number;
  filtered?: number;
  invalid?: number;
  inserted?: number;
  updated?: number;
  duplicates?: number;
  overLimit?: number;
  complete?: boolean;
  incompleteReason?: string;
}

/** Error that knows which window/query it belongs to, so a final failure can be recorded as a coverage gap. */
export class MonitorJobError extends Error {
  readonly provider: PublicSourceId | null;
  readonly window: SearchWindow | null;
  readonly query: { workspace_id: string; product_id: string } | null;

  constructor(
    cause: unknown,
    provider: PublicSourceId | null,
    window: SearchWindow | null,
    query: { workspace_id: string; product_id: string } | null,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "MonitorJobError";
    this.provider = provider;
    this.window = window;
    this.query = query;
  }
}

interface QueryRow {
  id: string;
  workspace_id: string;
  product_id: string;
  provider: string;
  params: { terms?: string[] };
  cursor: { until?: string };
  enabled: boolean;
}

export async function runMonitorQuery(
  admin: SupabaseClient,
  job: JobRow,
  adapters: Record<PublicSourceId, SourceAdapter>,
): Promise<MonitorResult> {
  const queryId = String(job.payload.query_id ?? "");
  const { data: q, error: qErr } = await admin
    .from("monitoring_queries")
    .select("id, workspace_id, product_id, provider, params, cursor, enabled")
    .eq("id", queryId)
    .maybeSingle<QueryRow>();
  if (qErr) throw new MonitorJobError(new SourceError("transient", "Couldn't load monitoring query"), null, null, null);
  if (!q || !isPublicSource(q.provider)) {
    return { provider: "hackernews", skipped: "query_disabled" };
  }
  const provider = q.provider;
  if (!q.enabled) return { provider, skipped: "query_disabled" };

  const { data: product } = await admin.from("products").select("archived_at").eq("id", q.product_id).maybeSingle();
  if (!product || product.archived_at) return { provider, skipped: "product_archived" };

  const now = new Date();
  const cursorUntil = q.cursor?.until ? new Date(q.cursor.until) : null;
  const requestedSince = typeof job.payload.since === "string" ? new Date(job.payload.since) : null;
  let since =
    requestedSince && !Number.isNaN(requestedSince.getTime()) ? requestedSince
    : cursorUntil ? new Date(cursorUntil.getTime() - OVERLAP_MS)
    : new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);
  if (since.getTime() < now.getTime() - MAX_LOOKBACK_MS) since = new Date(now.getTime() - MAX_LOOKBACK_MS);
  const window: SearchWindow = { since, until: now };
  const scope = { workspace_id: q.workspace_id, product_id: q.product_id };

  const adapter = adapters[provider];
  const setup = adapter.configured();
  if (!setup.ok) {
    await recordCoverage(admin, scope, provider, window, "failed", `Not configured: ${setup.reason}`, job.id);
    await recordHealth(admin, provider, { status: "not_configured", error: setup.reason });
    return { provider, skipped: "not_configured" };
  }

  const usage: UsageEvent[] = [];
  const ctx = createSourceContext(admin, provider, (endpoint) => adapter.rateLimit(endpoint), usage);
  try {
    const terms = (q.params?.terms ?? []).filter((t) => typeof t === "string" && t.trim()).slice(0, 5);
    const maxPages = Math.min(5, Math.max(1, Number(job.payload.max_pages ?? DEFAULT_MAX_PAGES)));
    const search = await adapter.searchMentions({ terms, window, maxPages }, ctx);

    // Match against ALL of the product's enabled keywords, not only this query's terms.
    const { data: aliasRows, error: aErr } = await admin
      .from("product_aliases")
      .select("term, kind, is_ambiguous, context_terms, negative_terms, enabled")
      .eq("product_id", q.product_id)
      .eq("enabled", true);
    if (aErr) throw new SourceError("transient", "Couldn't load keywords");
    const rules: AliasRule[] = (aliasRows ?? []).map((a) => ({
      term: a.term, kind: a.kind, isAmbiguous: a.is_ambiguous,
      contextTerms: a.context_terms ?? [], negativeTerms: a.negative_terms ?? [], enabled: a.enabled,
    }));

    const prepared = prepareIngest(search.items, rules, { now, retentionDays: adapter.retentionDays });
    const totals = { inserted: 0, updated: 0, duplicates: 0, over_limit: 0 };
    for (let i = 0; i < prepared.items.length; i += INGEST_CHUNK) {
      const { data, error } = await admin.rpc("svc_ingest_mentions", {
        p_product_id: q.product_id, p_source: provider, p_items: prepared.items.slice(i, i + INGEST_CHUNK),
      });
      if (error) throw new SourceError("transient", `Couldn't store mentions (${error.code ?? "db"})`);
      for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += Number(data?.[k] ?? 0);
    }

    const reasons: string[] = [];
    if (!search.complete && search.incompleteReason) reasons.push(search.incompleteReason);
    if (totals.over_limit > 0) reasons.push(`Monthly mention limit reached: ${totals.over_limit} new mention(s) were not stored.`);
    const complete = reasons.length === 0;

    await recordCoverage(admin, scope, provider, window, complete ? "complete" : "partial", reasons.join(" ") || null, job.id);
    await admin
      .from("monitoring_queries")
      .update({
        cursor: { until: new Date(Math.max(now.getTime(), cursorUntil?.getTime() ?? 0)).toISOString() },
        last_run_at: now.toISOString(),
      })
      .eq("id", q.id);
    await recordHealth(admin, provider, { status: "ok", detail: search.rateLimit ? { rate_limit: search.rateLimit } : {} });

    return {
      provider,
      windowStart: window.since.toISOString(),
      windowEnd: window.until.toISOString(),
      fetched: prepared.fetched,
      filtered: prepared.filtered,
      invalid: prepared.invalid,
      inserted: totals.inserted,
      updated: totals.updated,
      duplicates: totals.duplicates,
      overLimit: totals.over_limit,
      complete,
      incompleteReason: reasons.join(" ") || undefined,
    };
  } catch (e) {
    const err = e instanceof SourceError ? e : new SourceError("transient", e instanceof Error ? e.message : "Unknown error");
    await recordHealth(admin, provider, {
      status: err.kind === "auth" ? "error" : "degraded",
      error: err.message,
    });
    throw new MonitorJobError(err, provider, window, scope);
  } finally {
    if (usage.length > 0) {
      await admin.from("api_usage_events").insert(usage.map((u) => ({ ...u, workspace_id: q.workspace_id })));
    }
  }
}

export async function recordCoverage(
  admin: SupabaseClient,
  scope: { workspace_id: string; product_id: string },
  provider: PublicSourceId,
  window: SearchWindow,
  status: "complete" | "partial" | "failed",
  detail: string | null,
  jobId: string | null,
) {
  if (window.until.getTime() <= window.since.getTime()) return;
  await admin.from("coverage_windows").insert({
    ...scope, provider, status, detail: detail?.slice(0, 500) ?? null, job_id: jobId,
    window_start: window.since.toISOString(), window_end: window.until.toISOString(),
  });
}

export async function recordHealth(
  admin: SupabaseClient,
  provider: PublicSourceId,
  h: { status: "ok" | "degraded" | "error" | "not_configured"; error?: string; detail?: Record<string, unknown> },
) {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { provider, status: h.status, updated_at: now };
  if (h.status === "ok") {
    row.last_success_at = now;
    row.detail = h.detail ?? {};
  } else if (h.error) {
    row.last_error_at = now;
    row.last_error = h.error.slice(0, 500);
  }
  await admin.from("source_health").upsert(row, { onConflict: "provider" });
}
