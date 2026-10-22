import "server-only";
import { NEVER, scanStopped } from "./scan-pause";
import { failureRetry } from "@/lib/sources/retry";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auditDue, expansionsPerRun, formatInterval, nextRunAt, type Confidence } from "@/lib/sources/adaptive";
import { worthContinuing } from "@/lib/sources/adaptive-v2";
import {
  escalationPages, keywordHitShare, MIN_KEYWORD_SHARE_TO_ESCALATE, pagesToRequest, relevantShare, updateEstimate, upperRate, type GroupEstimate,
} from "@/lib/sources/arrival";
import { collectionProfile, jobCapacity, type CollectionProfile } from "@/lib/sources/collection-profile";
import { decideResume, observedSpanMinutes, oldestPublished, type Gap, type ResumeDecision } from "@/lib/sources/resume";
import { expansionParentOf } from "@/lib/sources/apidirect/adapters";
import { SourceError } from "@/lib/sources/errors";
import { selectExpansions, type ExpansionCandidate, type ExpansionHistory } from "@/lib/sources/expansion";
import { keywordIntervalMinutes, rotationNextRun, type Rotation } from "@/lib/sources/keyword-plan";
import { appStoreIds } from "@/lib/sources/official";
import { playPackage } from "@/lib/sources/google-play";
import { connectionFor, isConnectedSource } from "./connections";
import { prepareIngest, type IngestItem } from "@/lib/sources/pipeline";
import { isLegacySource, isPaidSource, isPublicSource, streamsOf } from "@/lib/sources/registry";
import type { AliasRule } from "@/lib/sources/relevance";
import type { CandidateMention, ExpansionParent, PublicSourceId, SearchResult, SearchWindow, SourceAdapter } from "@/lib/sources/types";
import { estimateFromRow, groupIntervalMinutes, refreshActivity } from "./activity";
import { createSourceContext, type BillingMember, type PaidCall, type UsageEvent } from "./context";
import { paidCollectionEnabled } from "./sources";
import { websiteDomain } from "./query-sync";

/** Re-scan this much before the last covered moment: search indexes lag behind publication. */
const OVERLAP_MS = 2 * 3_600_000;
/** First scheduled run without a scan looks back this far. */
const FIRST_RUN_LOOKBACK_MS = 24 * 3_600_000;
const MAX_LOOKBACK_MS = 90 * 86_400_000;
/** Paid scheduled runs never look back further than this (scans pass their own `since`). */
const PAID_MAX_SCHEDULED_LOOKBACK_MS = 7 * 86_400_000;
const AUDIT_LOOKBACK_MS = 7 * 86_400_000;
/** A continuation of an overflowing window runs this soon after the run that left it. */
const CONTINUATION_DELAY_MS = 30_000;
/** How often a search runs while the workspace's monthly mention allowance is used up. */
const OVER_LIMIT_INTERVAL_MINUTES = 360;
const INGEST_CHUNK = 250;
/** A shared fetch serves sibling queries that haven't been refreshed for this long. */
const SHARED_FRESH_MS = 30 * 60_000;
const MAX_SHARED_MEMBERS = 50;

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
  stream?: string;
  skipped?: "query_disabled" | "product_archived" | "not_configured" | "covered_by_shared" | "scan_stopped";
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
  saturated?: boolean;
  incompleteReason?: string;
  sharedWith?: number;
  expansions?: number;
  audit?: boolean;
  nextIntervalMinutes?: number;
  continuation?: boolean;
  gapLeft?: boolean;
  pagesRequested?: number;
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
  stream: string;
  query: string;
  params: { terms?: string[]; rotation?: Rotation };
  cursor: { until?: string; pages?: number; audit_missed?: number; gap?: Gap | null; continuations?: number };
  enabled: boolean;
  fingerprint: string | null;
  managed_by: "legacy" | "optimizer";
  interval_minutes: number | null;
  consecutive_failures: number;
  last_success_at: string | null;
  last_audit_at: string | null;
}

interface ScheduleContext {
  workspace_id: string;
  name: string;
  website_url: string | null;
  app_store_url: string | null;
  archived: boolean;
  plan_min_minutes: number;
  boost_min_minutes: number;
  paid_allowance_usd: number;
  boost: { id: string; mode: "balanced" | "priority"; ends_at: string; max_paid_checks: number } | null;
  last24h: number;
  prev24h: number;
  avg7d: number;
  avg28d: number;
  spike: boolean;
}

const QUERY_COLUMNS =
  "id, workspace_id, product_id, provider, stream, query, params, cursor, enabled, fingerprint, managed_by, interval_minutes, consecutive_failures, last_success_at, last_audit_at";

interface Schedule {
  intervalMinutes: number;
  reasons: string[];
  confidence: Confidence;
}

interface Member {
  q: QueryRow;
  ctx: ScheduleContext;
  rules: AliasRule[];
  window: SearchWindow;
}

async function loadRules(admin: SupabaseClient, productId: string): Promise<AliasRule[]> {
  const { data, error } = await admin
    .from("product_aliases")
    .select("term, kind, is_ambiguous, context_terms, negative_terms, enabled")
    .eq("product_id", productId)
    .eq("enabled", true);
  if (error) throw new SourceError("transient", "Couldn't load keywords");
  return (data ?? []).map((a) => ({
    term: a.term, kind: a.kind, isAmbiguous: a.is_ambiguous,
    contextTerms: a.context_terms ?? [], negativeTerms: a.negative_terms ?? [], enabled: a.enabled,
  }));
}

async function loadContext(admin: SupabaseClient, productId: string, platform: string): Promise<ScheduleContext | null> {
  const { data, error } = await admin.rpc("svc_schedule_context", { p_product_id: productId, p_platform: platform });
  if (error) throw new SourceError("transient", "Couldn't load schedule context");
  return (data as ScheduleContext | null) ?? null;
}

export function windowFor(q: Pick<QueryRow, "cursor">, now: Date, paid: boolean, requestedSince: Date | null, audit: boolean, historyUntil: Date | null = null): SearchWindow {
  const cursorUntil = q.cursor?.until ? new Date(q.cursor.until) : null;
  const firstRun = new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);
  let since =
    requestedSince && !Number.isNaN(requestedSince.getTime()) ? requestedSince
    : audit ? new Date(now.getTime() - AUDIT_LOOKBACK_MS)
    : cursorUntil ? new Date(cursorUntil.getTime() - OVERLAP_MS)
    // First check of a new search: a historical search already reads up to when it started,
    // so start there instead of fetching (and paying for) the same newest results twice.
    : historyUntil && historyUntil > firstRun ? new Date(Math.min(historyUntil.getTime(), now.getTime()))
    : firstRun;
  const maxBack = paid && !requestedSince ? PAID_MAX_SCHEDULED_LOOKBACK_MS : MAX_LOOKBACK_MS;
  if (since.getTime() < now.getTime() - maxBack) since = new Date(now.getTime() - maxBack);
  return { since, until: now };
}

/** End of a historical search started in the last day for this product (it covers the time before it). */
async function recentHistoryEnd(admin: SupabaseClient, productId: string, now: Date): Promise<Date | null> {
  const { data } = await admin.from("backfill_runs").select("range_end")
    .eq("product_id", productId).neq("status", "canceled")
    .gt("range_end", new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS).toISOString())
    .order("range_end", { ascending: false }).limit(1).maybeSingle<{ range_end: string }>();
  return data ? new Date(data.range_end) : null;
}

/** Search + (for page-billed sources without resume) one right-sized escalation when the first call overflowed. */
export async function searchWithEscalation(
  adapter: SourceAdapter,
  req: Parameters<SourceAdapter["searchMentions"]>[0],
  sctx: Parameters<SourceAdapter["searchMentions"]>[1],
  profile: CollectionProfile,
  capPages: number,
): Promise<SearchResult & { escalated: boolean }> {
  const first = await adapter.searchMentions(req, sctx);
  const requested = first.pagesRequested ?? req.maxPages;
  if (!adapter.paid || profile.billing !== "pages" || profile.resume === "range" || !first.saturated || requested >= capPages) {
    return { ...first, escalated: false };
  }
  if (keywordHitShare(first.items.map((i) => i.matchText), req.terms) < MIN_KEYWORD_SHARE_TO_ESCALATE) {
    return { ...first, escalated: false };
  }
  const oldest = oldestPublished(first.items);
  const pages = escalationPages({
    returned: first.items.length, spanMinutes: observedSpanMinutes(first.items, req.window),
    remainingMinutes: oldest ? Math.max(0, (oldest.getTime() - req.window.since.getTime()) / 60_000) : (req.window.until.getTime() - req.window.since.getTime()) / 60_000,
    perPage: profile.perPage, maxPages: capPages, requested,
  });
  if (pages <= requested) return { ...first, escalated: false };
  try {
    // One call with more pages (it bills every page again, so it happens at most once per run).
    const again = await adapter.searchMentions({ ...req, maxPages: pages }, sctx);
    const items = new Map(first.items.map((i) => [i.externalId, i]));
    for (const i of again.items) items.set(i.externalId, i);
    return { ...again, items: [...items.values()], pagesRequested: requested + (again.pagesRequested ?? pages), escalated: true };
  } catch (e) {
    // A refused budget reservation keeps the first results (recorded as partial).
    if (e instanceof SourceError && e.kind === "budget") return { ...first, escalated: false };
    throw e;
  }
}

export async function runMonitorQuery(
  admin: SupabaseClient,
  job: JobRow,
  adapters: Record<PublicSourceId, SourceAdapter>,
): Promise<MonitorResult> {
  const queryId = String(job.payload.query_id ?? "");
  const { data: q, error: qErr } = await admin.from("monitoring_queries").select(QUERY_COLUMNS).eq("id", queryId).maybeSingle<QueryRow>();
  if (qErr) throw new MonitorJobError(new SourceError("transient", "Couldn't load monitoring query"), null, null, null);
  if (!q || !isPublicSource(q.provider)) return { provider: "hackernews", skipped: "query_disabled" };
  const provider = q.provider;
  const adapter = adapters[provider];
  if (!q.enabled) return { provider, stream: q.stream, skipped: "query_disabled" };
  // Stop scan: no source is called; the search stays parked until scanning resumes.
  if (await scanStopped(admin, q.product_id)) {
    await admin.from("monitoring_queries").update({ next_run_at: NEVER }).eq("id", q.id);
    return { provider, stream: q.stream, skipped: "scan_stopped" };
  }

  const started = new Date();
  const ctx = await loadContext(admin, q.product_id, provider).catch(() => null);
  if (!ctx || ctx.archived) return { provider, stream: q.stream, skipped: "product_archived" };

  const now = new Date();
  const paid = Boolean(adapter.paid);
  const requestedSince = typeof job.payload.since === "string" ? new Date(job.payload.since) : null;
  const isScan = Boolean(job.scan_id) || requestedSince !== null;
  const stream = streamsOf(adapter).find((s) => s.id === q.stream) ?? streamsOf(adapter)[0]!;
  const profile = collectionProfile(provider, stream.id);
  // An earlier run that overflowed left part of its window unread: continue it first.
  const gap = !isScan && profile.resume !== "none" && q.cursor?.gap ? q.cursor.gap : null;
  // Activity importance from the last ranking (null while the platform is new) sets audit cadence and expansion budget.
  const { data: act } = await admin.from("platform_activity").select("score, phase")
    .eq("product_id", q.product_id).eq("platform", provider).maybeSingle<{ score: number | null; phase: string }>();
  const score = act?.phase === "ranked" ? act.score : null;
  const audit = !isScan && !gap && !isLegacySource(provider) && auditDue(q.last_audit_at ? new Date(q.last_audit_at) : null, paid, score, now);
  const historyUntil = !q.cursor?.until && !isScan && !audit ? await recentHistoryEnd(admin, q.product_id, now) : null;
  const leadWindow = gap ? { since: new Date(gap.since), until: new Date(gap.until) } : windowFor(q, now, paid, requestedSince, audit, historyUntil);
  const scope = { workspace_id: q.workspace_id, product_id: q.product_id };

  const setup = adapter.configured();
  const paidBlocked = paid && !paidCollectionEnabled();
  if (!setup.ok || paidBlocked) {
    const reason = !setup.ok ? setup.reason : "Paid sources are switched off on this server.";
    await recordCoverage(admin, scope, provider, leadWindow, "failed", `Not configured: ${reason}`, job.id);
    await recordHealth(admin, provider, { status: "not_configured", error: reason });
    await logExecution(admin, { q, job, started, status: "skipped", detail: reason });
    return { provider, stream: q.stream, skipped: "not_configured" };
  }

  // Refreshed minutes ago (by a scan, or by an identical query's shared fetch): don't fetch again.
  if (!isScan && !gap && q.fingerprint && adapter.shareable && q.last_success_at && now.getTime() - new Date(q.last_success_at).getTime() < 10 * 60_000) {
    await logExecution(admin, { q, job, started, status: "covered_by_shared", detail: "Already checked in the last 10 minutes" });
    return { provider, stream: q.stream, skipped: "covered_by_shared" };
  }

  // Shared query registry: one upstream fetch serves every product with the same fingerprint
  // (continuations work on one product's own unread window, so they aren't shared).
  let lockHolder: string | null = null;
  const members: Member[] = [{ q, ctx, rules: await loadRules(admin, q.product_id), window: leadWindow }];
  if (!isScan && !gap && q.fingerprint && adapter.shareable) {
    lockHolder = `job:${job.id}`;
    const { data: got } = await admin.rpc("svc_try_acquire_lock", { p_name: `fp:${q.fingerprint.slice(0, 40)}`, p_holder: lockHolder, p_ttl_seconds: 170 });
    if (!got) throw new MonitorJobError(new SourceError("rate_limited", "An identical query is being fetched", { retryAfterSeconds: 90 }), provider, leadWindow, scope);
    const { data: siblings } = await admin
      .from("monitoring_queries")
      .select(QUERY_COLUMNS)
      .eq("fingerprint", q.fingerprint)
      .eq("enabled", true)
      .neq("id", q.id)
      .limit(MAX_SHARED_MEMBERS);
    for (const s of (siblings ?? []) as QueryRow[]) {
      if (s.last_success_at && now.getTime() - new Date(s.last_success_at).getTime() < SHARED_FRESH_MS) continue;
      if (s.cursor?.gap) continue; // it has its own unread window to finish first
      const sctx = await loadContext(admin, s.product_id, provider).catch(() => null);
      if (!sctx || sctx.archived) continue;
      if (paid && sctx.paid_allowance_usd <= 0) continue;
      members.push({ q: s, ctx: sctx, rules: await loadRules(admin, s.product_id), window: windowFor(s, now, paid, null, false) });
    }
  }

  const fetchWindow: SearchWindow = {
    since: new Date(Math.min(...members.map((m) => m.window.since.getTime()))),
    until: gap ? leadWindow.until : now,
  };
  // Page right-sizing: page-billed calls request what this search's arrival rate needs
  // (one page while it's new); others page on by themselves and stop at a partial page.
  const { data: est } = await admin.from("arrival_estimates")
    .select("query_id, raw_alpha, raw_beta, rel_alpha, rel_beta, observations, saturations, exposure_hours, last_observed_at")
    .eq("query_id", q.id).maybeSingle();
  const estimate = estimateFromRow(est ?? undefined);
  const capPages = Math.max(1, Math.min(stream.capabilities.maxPagesPerRun, profile.maxPagesPerJob, isLegacySource(provider) ? 5 : 10));
  const planned = profile.billing === "pages"
    ? pagesToRequest({
      ratePerHour: upperRate(estimate.raw), windowMinutes: (fetchWindow.until.getTime() - fetchWindow.since.getTime()) / 60_000,
      perPage: profile.perPage, maxPages: capPages, billing: "pages", learning: estimate.observations === 0,
      relevantShare: relevantShare(estimate),
    })
    : capPages;
  const maxPages = Math.min(capPages, planned + (audit ? 1 : 0));

  const usage: UsageEvent[] = [];
  const paidCalls: PaidCall[] = [];
  const billingMembers: BillingMember[] = members.map((m) => ({
    workspace_id: m.q.workspace_id, product_id: m.q.product_id, boost_id: m.ctx.boost?.id ?? null,
  }));
  const sctx = createSourceContext(admin, provider, (endpoint) => adapter.rateLimit(endpoint), usage,
    { members: billingMembers, jobId: job.id, fingerprint: q.fingerprint }, paidCalls);

  try {
    const terms = (q.params?.terms ?? []).filter((t) => typeof t === "string" && t.trim()).slice(0, 10);
    const app = appStoreIds(ctx.app_store_url);
    // Connected sources read the customer's own account: their connection (decrypted here, never logged).
    let connection: { secret: string | null; config: Record<string, unknown> } | null = null;
    let playPkg: string | null = null;
    if (isConnectedSource(provider)) {
      const c = await connectionFor(admin, provider, q.product_id, q.workspace_id);
      if (!c) throw new SourceError("auth", `${adapter.name} isn't connected for this product.`);
      connection = { secret: c.secret, config: c.config };
      if (provider === "google_play") {
        const { data: pr } = await admin.from("products").select("play_store_url").eq("id", q.product_id).maybeSingle();
        playPkg = playPackage(pr?.play_store_url as string | null);
      }
    }
    const search = await searchWithEscalation(adapter, {
      terms: terms.length ? terms : [ctx.name],
      window: fetchWindow,
      maxPages,
      startPage: gap?.page,
      stream: q.stream === "default" ? undefined : q.stream,
      query: q.managed_by === "optimizer" ? q.query : undefined,
      target: { websiteDomain: websiteDomain(ctx.website_url), appStoreId: app?.id ?? null, appStoreCountry: app?.country ?? null, playPackage: playPkg, connection },
    }, sctx, profile, capPages);

    // Selective comment expansion for platforms without global comment search.
    let expansion: SearchResult | null = null;
    let expandedParents: ExpansionParent[] = [];
    if (adapter.expandComments && !audit && !gap) {
      expandedParents = await chooseExpansions(admin, provider, search.items, members, expansionsPerRun(score), now);
      if (expandedParents.length > 0) {
        try {
          expansion = await adapter.expandComments(expandedParents, sctx);
        } catch (e) {
          // Expansion is best-effort; the search results still count.
          if (!(e instanceof SourceError) || e.kind === "auth") throw e;
          console.error(`[monitor] ${provider} expansion skipped: ${e.message}`);
        }
      }
    }
    const allItems = [...search.items, ...(expansion?.items ?? [])];
    // Milestone 2 adapters report caps as "incomplete" only; treat that as saturation.
    if (search.saturated === undefined && !search.complete) search.saturated = true;

    const perRequest = new Map<string, { relevant: number; duplicates: number }>();
    const results: MonitorResult[] = [];
    for (const m of members) {
      const r = await ingestForMember(admin, provider, adapter, m, allItems, search, now, perRequest);
      const resume = decideResume({
        profile, window: m.window, items: search.items.filter((i) => i.publishedAt >= m.window.since), saturated: Boolean(search.saturated),
        pagesRead: search.pagesRequested ?? maxPages, previous: m.q.id === q.id ? gap : null, platformName: adapter.name,
      });
      if (resume.gap && !worthContinuing(paid, estimate)) {
        // Mostly unrelated results: record the unread part as partial instead of paying for follow-ups.
        resume.lost = {
          since: new Date(resume.gap.since), until: new Date(resume.gap.until),
          reason: `Most ${adapter.name} results for this search aren't about the product, so the rest of this busy window wasn't fetched.`,
        };
        resume.gap = null;
      }
      const decision = await finishMember(admin, m, provider, job, started, r, search, resume, {
        audit: audit && m.q.id === q.id, sharedWith: members.length, continuation: m.q.id === q.id && gap !== null,
        expansions: m.q.id === q.id ? expandedParents.length : 0,
        paidRequests: m.q.id === q.id ? paidCalls.length : 0,
        pages: m.q.id === q.id ? search.pagesRequested ?? maxPages : 0,
        profile,
      });
      results.push({ ...r.result, nextIntervalMinutes: decision.intervalMinutes, continuation: gap !== null, gapLeft: resume.gap !== null, pagesRequested: search.pagesRequested ?? maxPages });
    }
    if (expandedParents.length > 0) await recordExpansions(admin, provider, members, expandedParents, expansion, now);
    for (const [ledgerId, v] of perRequest) {
      await admin.rpc("svc_annotate_api_spend", { p_ledger_id: ledgerId, p_relevant: v.relevant, p_duplicates: v.duplicates });
    }
    await recordHealth(admin, provider, { status: "ok", detail: search.rateLimit ? { rate_limit: search.rateLimit } : {} });

    return { ...results[0]!, sharedWith: members.length, expansions: expandedParents.length, audit };
  } catch (e) {
    const err = e instanceof SourceError ? e : new SourceError("transient", e instanceof Error ? e.message : "Unknown error");
    if (err.kind !== "budget") {
      await recordHealth(admin, provider, { status: err.kind === "auth" ? "error" : "degraded", error: err.message });
    }
    // Checkpoints (and any unread gap) don't move; the next run re-searches (sooner after failures).
    for (const m of members) {
      const failures = m.q.consecutive_failures + 1;
      const interval = m.q.interval_minutes ?? m.ctx.plan_min_minutes;
      const retry = failureRetry(err, interval, failures, adapter.name, now);
      await admin.from("monitoring_queries").update({
        consecutive_failures: failures,
        next_run_at: retry.next.toISOString(),
        coverage_confidence: failures >= 2 ? "low" : "medium",
        interval_reasons: [retry.reason],
      }).eq("id", m.q.id);
      await logExecution(admin, { q: m.q, job, started, status: "failed", detail: err.message, paidRequests: m.q.id === q.id ? paidCalls.length : 0, continuation: m.q.id === q.id && gap !== null });
    }
    throw new MonitorJobError(err, provider, leadWindow, scope);
  } finally {
    if (lockHolder && q.fingerprint) await admin.rpc("svc_release_lock", { p_name: `fp:${q.fingerprint.slice(0, 40)}`, p_holder: lockHolder });
    if (usage.length > 0) {
      await admin.from("api_usage_events").insert(usage.map((u) => ({ ...u, workspace_id: q.workspace_id })));
    }
  }
}

/** Ingests one product's historical results (no shared fetch, no audit bookkeeping). */
export async function ingestForBackfill(
  admin: SupabaseClient, provider: PublicSourceId, adapter: SourceAdapter, productId: string, items: CandidateMention[], now: Date,
): Promise<{ inserted: number; duplicates: number; overLimit: number; relevant: number }> {
  const rules = await loadRules(admin, productId);
  const prepared = prepareIngest(items, rules, { now, retentionDays: adapter.retentionDays });
  const rows = prepared.items.map(({ origin_request_id: _o, ...rest }) => rest);
  const totals = { inserted: 0, duplicates: 0, overLimit: 0 };
  for (let i = 0; i < rows.length; i += INGEST_CHUNK) {
    const { data, error } = await admin.rpc("svc_ingest_mentions", { p_product_id: productId, p_source: provider, p_items: rows.slice(i, i + INGEST_CHUNK) });
    if (error) throw new SourceError("transient", `Couldn't store mentions (${error.code ?? "db"})`);
    totals.inserted += Number(data?.inserted ?? 0);
    totals.duplicates += Number(data?.duplicates ?? 0);
    totals.overLimit += Number(data?.over_limit ?? 0);
  }
  return { ...totals, relevant: prepared.items.length };
}

interface MemberIngest {
  result: MonitorResult;
  complete: boolean;
  reasons: string[];
  relevant: number;
  inserted: number;
  duplicates: number;
  fetched: number;
  auditMissed: number;
}

async function ingestForMember(
  admin: SupabaseClient,
  provider: PublicSourceId,
  adapter: SourceAdapter,
  m: Member,
  items: CandidateMention[],
  search: SearchResult,
  now: Date,
  perRequest: Map<string, { relevant: number; duplicates: number }>,
): Promise<MemberIngest> {
  const prepared = prepareIngest(items, m.rules, { now, retentionDays: adapter.retentionDays });
  // Ingest per originating paid request so relevant/duplicate counts can be attributed to it.
  const byOrigin = new Map<string, IngestItem[]>();
  for (const it of prepared.items) {
    const k = it.origin_request_id ?? "";
    if (!byOrigin.has(k)) byOrigin.set(k, []);
    byOrigin.get(k)!.push(it);
  }
  const totals = { inserted: 0, updated: 0, duplicates: 0, over_limit: 0 };
  const cursorUntil = m.q.cursor?.until ? new Date(m.q.cursor.until).getTime() - OVERLAP_MS : null;
  let auditMissed = 0;
  for (const [origin, list] of byOrigin) {
    const rows = list.map(({ origin_request_id: _o, ...rest }) => rest);
    for (let i = 0; i < rows.length; i += INGEST_CHUNK) {
      const chunk = rows.slice(i, i + INGEST_CHUNK);
      const { data, error } = await admin.rpc("svc_ingest_mentions", { p_product_id: m.q.product_id, p_source: provider, p_items: chunk });
      if (error) throw new SourceError("transient", `Couldn't store mentions (${error.code ?? "db"})`);
      for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += Number(data?.[k] ?? 0);
      // An audit insert of something published before the last checkpoint = regular checks missed it.
      if (cursorUntil !== null && Number(data?.inserted ?? 0) > 0) {
        const old = chunk.filter((c) => new Date(c.published_at).getTime() < cursorUntil).length;
        auditMissed += Math.min(old, Number(data?.inserted ?? 0));
      }
      if (origin) {
        const cur = perRequest.get(origin) ?? { relevant: 0, duplicates: 0 };
        cur.relevant += chunk.length;
        cur.duplicates += Number(data?.duplicates ?? 0);
        perRequest.set(origin, cur);
      }
    }
  }

  const reasons: string[] = [];
  if (!search.complete && search.incompleteReason) reasons.push(search.incompleteReason);
  if (totals.over_limit > 0) reasons.push(`Monthly mention limit reached: ${totals.over_limit} new mention(s) were not stored.`);
  const complete = reasons.length === 0;
  return {
    complete, reasons, relevant: prepared.items.length, inserted: totals.inserted, duplicates: totals.duplicates,
    fetched: prepared.fetched, auditMissed,
    result: {
      provider, stream: m.q.stream,
      windowStart: m.window.since.toISOString(), windowEnd: m.window.until.toISOString(),
      fetched: prepared.fetched, filtered: prepared.filtered, invalid: prepared.invalid,
      inserted: totals.inserted, updated: totals.updated, duplicates: totals.duplicates, overLimit: totals.over_limit,
      complete, saturated: search.saturated, incompleteReason: reasons.join(" ") || undefined,
    },
  };
}

/** Where the read part of a window starts, given what remains unread or unreachable. */
export function readSince(window: SearchWindow, resume: ResumeDecision, items: CandidateMention[]): Date {
  if (resume.gap?.page !== undefined) {
    const oldest = oldestPublished(items);
    return oldest && oldest > window.since && oldest < window.until ? oldest : window.until;
  }
  if (resume.gap) return new Date(Math.min(window.until.getTime(), new Date(resume.gap.until).getTime()));
  if (resume.lost) return new Date(Math.min(window.until.getTime(), resume.lost.until.getTime()));
  return window.since;
}

async function finishMember(
  admin: SupabaseClient,
  m: Member,
  provider: PublicSourceId,
  job: JobRow,
  started: Date,
  r: MemberIngest,
  search: SearchResult,
  resume: ResumeDecision,
  extra: { audit: boolean; sharedWith: number; continuation: boolean; expansions: number; paidRequests: number; pages: number; profile: CollectionProfile },
): Promise<Schedule> {
  const now = new Date();
  const scope = { workspace_id: m.q.workspace_id, product_id: m.q.product_id };
  const overLimit = (r.result.overLimit ?? 0) > 0;
  const memberItems = search.items.filter((i) => i.publishedAt >= m.window.since);

  // Coverage: the part read is complete (unless the source is inherently partial or the mention
  // allowance held items back); an unreachable part is partial with the reason; an unread gap is
  // recorded when a continuation reads it.
  const readFrom = readSince(m.window, resume, memberItems);
  const otherReasons = r.reasons.filter((x) => x !== search.incompleteReason || (!search.saturated && !search.complete));
  const readComplete = !overLimit && (search.complete || Boolean(search.saturated));
  await recordCoverage(admin, scope, provider, { since: readFrom, until: m.window.until }, readComplete && otherReasons.length === 0 ? "complete" : "partial",
    otherReasons.join(" ") || null, job.id);
  if (resume.lost) await recordCoverage(admin, scope, provider, { since: resume.lost.since, until: resume.lost.until }, "partial", resume.lost.reason, job.id);

  // Checkpoint: a regular run advances to its window end — what it didn't read is kept as a gap
  // (resumable sources) or recorded as lost (others). It holds when the mention allowance held
  // items back, so they're searched again once it renews. Continuations never move it.
  const prevUntil = m.q.cursor?.until ? new Date(m.q.cursor.until).getTime() : 0;
  const until = extra.continuation || overLimit ? prevUntil : Math.max(m.window.until.getTime(), prevUntil);
  const gap = overLimit ? (m.q.cursor?.gap ?? null) : resume.gap;
  const cursor: QueryRow["cursor"] = {
    until: until > 0 ? new Date(until).toISOString() : undefined,
    pages: extra.pages || m.q.cursor?.pages,
    audit_missed: extra.audit ? r.auditMissed : m.q.cursor?.audit_missed ?? 0,
    gap,
    continuations: gap ? (m.q.cursor?.continuations ?? 0) + 1 : 0,
  };
  await admin.from("monitoring_queries").update({
    cursor,
    last_run_at: now.toISOString(),
    last_success_at: now.toISOString(),
    consecutive_failures: 0,
    ...(search.saturated ? { last_saturated_at: now.toISOString() } : {}),
    ...(extra.audit ? { last_audit_at: now.toISOString() } : {}),
  }).eq("id", m.q.id);

  // Arrival-rate estimate (audits re-read old windows, so they'd double count).
  const span = observedSpanMinutes(memberItems, m.window);
  // Undated, ranked results (web search) return mostly the same pages every check: only new ones
  // are arrivals, or a quiet search would look busy and be checked every hour.
  const undated = memberItems.length > 0 && memberItems.every((i) => i.publishedAtEstimated);
  if (!extra.audit) await updateArrival(admin, m, provider, extra.profile, {
    results: undated ? r.inserted : memberItems.length, relevant: undated ? Math.min(r.relevant, r.inserted) : r.relevant,
    windowStart: m.window.since, windowEnd: m.window.until,
    saturated: Boolean(search.saturated), observedSpanMinutes: span, at: now,
  });

  // Re-rank the product's platforms with what this run stored (no API calls), then schedule this group.
  const ranking = await refreshActivity(admin, m.q.product_id, { exceptQueryId: m.q.id }).catch((e) => {
    console.error(`[monitor] ranking refresh failed: ${e instanceof Error ? e.message : e}`);
    return null;
  });
  const p = ranking?.get(provider);
  // A search that takes turns with others (keyword rotation) runs in its own time slots,
  // unless it would overflow before its turn (then it's checked out of turn).
  const rotation = m.q.params?.rotation ?? null;
  const platformInterval = p?.decision.interval ?? null;
  const g = p ? groupIntervalMinutes(p, m.q.id, rotation, p.decision.interval) : null;
  const d: Schedule = p && g
    ? {
      intervalMinutes: g.minutes,
      reasons: [...p.assessment.notes, ...p.decision.reasons,
        ...(g.outOfTurn ? [`Busy search: checked every ${formatInterval(g.minutes)}, ahead of its turn, so its results don't overflow`] : rotation ? [rotationReason(rotation, p.decision.interval)] : [])],
      confidence: p.assessment.confidence,
    }
    : { intervalMinutes: m.q.interval_minutes ?? m.ctx.plan_min_minutes, reasons: ["Kept the current interval (ranking unavailable)"], confidence: r.complete ? "medium" : "low" };
  if (overLimit) {
    // The allowance is used up: re-reading the same window would only fetch posts that can't be
    // stored. No follow-up checks, and regular checks slow down until the allowance renews or grows
    // (the checkpoint held, so nothing is skipped when they resume).
    d.intervalMinutes = Math.max(d.intervalMinutes, OVER_LIMIT_INTERVAL_MINUTES);
    d.reasons.unshift("Monthly mention limit reached: checking less often until the allowance renews");
  } else if (gap) d.reasons.unshift("More results than one check can read: the rest of the window is being collected by follow-up checks");
  await admin.from("monitoring_queries").update({
    interval_minutes: d.intervalMinutes,
    interval_reasons: d.reasons,
    coverage_confidence: d.confidence,
    next_run_at: (rotation && platformInterval && !g?.outOfTurn && !overLimit ? rotationNextRun(now, platformInterval, rotation) : nextRunAt(now, d.intervalMinutes, 0)).toISOString(),
  }).eq("id", m.q.id);
  if (gap && !overLimit) {
    // Continue the unread window shortly (own idempotency key: the scheduler's bucket key would collide).
    await admin.rpc("svc_enqueue_job", {
      p_kind: "monitor.query", p_idempotency_key: `mq-cont:${m.q.id}:${until}:${cursor.continuations}`,
      p_payload: { query_id: m.q.id }, p_workspace_id: m.q.workspace_id, p_product_id: m.q.product_id,
      p_run_after: new Date(now.getTime() + CONTINUATION_DELAY_MS).toISOString(), p_priority: 90,
    });
  }
  await logExecution(admin, {
    q: m.q, job, started, status: r.complete && !resume.lost ? "succeeded" : "partial",
    window: m.window, pages: extra.pages, fetched: r.fetched, relevant: r.relevant, inserted: r.inserted, duplicates: r.duplicates,
    saturated: Boolean(search.saturated), paidRequests: extra.paidRequests, sharedWith: extra.sharedWith, expansions: extra.expansions,
    decision: d, observedSpan: span, continuation: extra.continuation,
    detail: [extra.audit ? `Completeness audit: ${r.auditMissed} missed mention(s) found.` : null, r.reasons.join(" ") || null, resume.lost?.reason ?? null,
      gap && !overLimit ? "Continuing the rest of the window in a follow-up check." : null].filter(Boolean).join(" ") || null,
  });
  await emitEvent(admin, m.q.workspace_id, m.q.product_id, r.inserted > 0 ? "mentions" : "monitoring", { inserted: r.inserted, platform: provider });
  return d;
}

async function updateArrival(
  admin: SupabaseClient, m: Member, provider: PublicSourceId, profile: CollectionProfile, o: Parameters<typeof updateEstimate>[1],
) {
  const { data: row } = await admin.from("arrival_estimates")
    .select("query_id, raw_alpha, raw_beta, rel_alpha, rel_beta, observations, saturations, exposure_hours, last_observed_at")
    .eq("query_id", m.q.id).maybeSingle();
  const next: GroupEstimate = updateEstimate(estimateFromRow(row ?? undefined), o);
  const { error } = await admin.from("arrival_estimates").upsert({
    query_id: m.q.id, workspace_id: m.q.workspace_id, product_id: m.q.product_id, platform: provider, stream: m.q.stream,
    raw_alpha: next.raw.alpha, raw_beta: next.raw.beta, rel_alpha: next.rel.alpha, rel_beta: next.rel.beta,
    observations: next.observations, saturations: next.saturations, exposure_hours: next.exposureHours,
    capacity_per_check: jobCapacity(profile), last_observed_at: o.at.toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: "query_id" });
  if (error) console.error(`[monitor] arrival estimate not stored (${error.code ?? "db"})`);
}

/** Workspace-scoped change signal for live dashboards (counts only; coalesced in the database). */
export async function emitEvent(admin: SupabaseClient, workspaceId: string, productId: string | null, kind: "mentions" | "monitoring" | "backfill" | "usage" | "spikes" | "ai", payload: Record<string, unknown> = {}) {
  const { error } = await admin.rpc("svc_emit_workspace_event", { p_workspace_id: workspaceId, p_product_id: productId, p_kind: kind, p_payload: payload });
  if (error) console.error(`[events] not emitted (${error.code ?? "db"})`);
}

export function rotationReason(r: Rotation, platformIntervalMinutes: number): string {
  const every = formatInterval(keywordIntervalMinutes(platformIntervalMinutes, r));
  return `Takes turns with ${r.rotating - 1} other search${r.rotating === 2 ? "" : "es"} on this platform (${r.slots} per check): searched every ${every}`;
}

async function chooseExpansions(
  admin: SupabaseClient, provider: PublicSourceId, items: CandidateMention[], members: Member[], maxParents: number, now: Date,
): Promise<ExpansionParent[]> {
  const candidates: ExpansionCandidate[] = [];
  const now2 = new Date();
  for (const it of items) {
    if (it.parentExternalId || (it.mentionType && it.mentionType !== "post" && it.mentionType !== "video" && it.mentionType !== "article")) continue;
    // Relevance to any member product (the comments are filtered per product afterwards).
    let best = 0;
    for (const m of members) {
      const p = prepareIngest([it], m.rules, { now: now2 });
      if (p.items[0]) best = Math.max(best, p.items[0].relevance_score);
    }
    if (best < 0.75) continue;
    const parent = provider === "dev"
      ? (it.externalId.startsWith("article:") ? { externalId: it.externalId, platformId: it.externalId.slice(8), sourceUrl: it.sourceUrl, title: it.title ?? null, commentCount: it.engagement.comments ?? 0, publishedAt: it.publishedAt } : null)
      : isPaidSource(provider) ? expansionParentOf(provider, it) : null;
    if (parent) candidates.push({ parent, relevance: best });
  }
  if (candidates.length === 0) return [];
  const { data } = await admin
    .from("comment_expansions")
    .select("parent_external_id, last_expanded_at, comment_count_at_last")
    .eq("product_id", members[0]!.q.product_id)
    .eq("platform", provider)
    .in("parent_external_id", candidates.map((c) => c.parent.externalId).slice(0, 200));
  const history = new Map<string, ExpansionHistory>(
    (data ?? []).map((h) => [h.parent_external_id as string, { lastExpandedAt: new Date(h.last_expanded_at as string), commentCountAtLast: h.comment_count_at_last as number }]),
  );
  return selectExpansions(candidates, history, { maxParents, now }).selected;
}

async function recordExpansions(
  admin: SupabaseClient, provider: PublicSourceId, members: Member[], parents: ExpansionParent[], expansion: SearchResult | null, now: Date,
) {
  const found = new Map<string, number>();
  for (const it of expansion?.items ?? []) if (it.parentExternalId) found.set(it.parentExternalId, (found.get(it.parentExternalId) ?? 0) + 1);
  for (const m of members) {
    const rows = parents.map((p) => ({
      workspace_id: m.q.workspace_id, product_id: m.q.product_id, platform: provider, parent_external_id: p.externalId,
      last_expanded_at: now.toISOString(), comment_count_at_last: p.commentCount, last_found: found.get(p.externalId) ?? 0,
    }));
    await admin.from("comment_expansions").upsert(rows, { onConflict: "product_id,platform,parent_external_id" });
  }
}

async function logExecution(
  admin: SupabaseClient,
  e: {
    q: QueryRow; job: JobRow; started: Date; status: "succeeded" | "partial" | "failed" | "skipped" | "covered_by_shared";
    window?: SearchWindow; pages?: number; fetched?: number; relevant?: number; inserted?: number; duplicates?: number;
    saturated?: boolean; paidRequests?: number; sharedWith?: number; expansions?: number; decision?: Schedule; detail?: string | null;
    observedSpan?: number | null; continuation?: boolean; backfillTaskId?: string;
  },
) {
  await admin.from("monitoring_executions").insert({
    workspace_id: e.q.workspace_id, product_id: e.q.product_id, query_id: e.q.id, job_id: e.job.id,
    platform: e.q.provider, stream: e.q.stream, status: e.status, started_at: e.started.toISOString(),
    window_start: e.window?.since.toISOString() ?? null, window_end: e.window?.until.toISOString() ?? null,
    pages_requested: e.pages ?? 0, items_fetched: e.fetched ?? 0, items_relevant: e.relevant ?? 0,
    inserted: e.inserted ?? 0, duplicates: e.duplicates ?? 0, saturated: e.saturated ?? false,
    paid_requests: e.paidRequests ?? 0, shared_with: e.sharedWith ?? 1, expansions: e.expansions ?? 0,
    next_interval_minutes: e.decision?.intervalMinutes ?? null, interval_reasons: e.decision?.reasons ?? [],
    coverage_confidence: e.decision?.confidence ?? null, detail: e.detail?.slice(0, 500) ?? null,
    observed_span_minutes: e.observedSpan ?? null, continuation: e.continuation ? 1 : 0, backfill_task_id: e.backfillTaskId ?? null,
  });
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
