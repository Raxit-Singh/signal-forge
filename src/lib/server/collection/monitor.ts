import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auditDue, expansionsPerRun, formatInterval, nextRunAt, type Confidence } from "@/lib/sources/adaptive";
import { expansionParentOf } from "@/lib/sources/apidirect/adapters";
import { SourceError } from "@/lib/sources/errors";
import { selectExpansions, type ExpansionCandidate, type ExpansionHistory } from "@/lib/sources/expansion";
import { keywordIntervalMinutes, rotationNextRun, type Rotation } from "@/lib/sources/keyword-plan";
import { appStoreIds } from "@/lib/sources/official";
import { prepareIngest, type IngestItem } from "@/lib/sources/pipeline";
import { isLegacySource, isPaidSource, isPublicSource, streamsOf } from "@/lib/sources/registry";
import type { AliasRule } from "@/lib/sources/relevance";
import type { CandidateMention, ExpansionParent, PublicSourceId, SearchResult, SearchWindow, SourceAdapter } from "@/lib/sources/types";
import { refreshActivity } from "./activity";
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
const DEFAULT_MAX_PAGES = 2;
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
  skipped?: "query_disabled" | "product_archived" | "not_configured" | "covered_by_shared";
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
  cursor: { until?: string; pages?: number; audit_missed?: number };
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

function windowFor(q: QueryRow, now: Date, paid: boolean, requestedSince: Date | null, audit: boolean): SearchWindow {
  const cursorUntil = q.cursor?.until ? new Date(q.cursor.until) : null;
  let since =
    requestedSince && !Number.isNaN(requestedSince.getTime()) ? requestedSince
    : audit ? new Date(now.getTime() - AUDIT_LOOKBACK_MS)
    : cursorUntil ? new Date(cursorUntil.getTime() - OVERLAP_MS)
    : new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);
  const maxBack = paid && !requestedSince ? PAID_MAX_SCHEDULED_LOOKBACK_MS : MAX_LOOKBACK_MS;
  if (since.getTime() < now.getTime() - maxBack) since = new Date(now.getTime() - maxBack);
  return { since, until: now };
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

  const started = new Date();
  const ctx = await loadContext(admin, q.product_id, provider).catch(() => null);
  if (!ctx || ctx.archived) return { provider, stream: q.stream, skipped: "product_archived" };

  const now = new Date();
  const paid = Boolean(adapter.paid);
  const requestedSince = typeof job.payload.since === "string" ? new Date(job.payload.since) : null;
  const isScan = Boolean(job.scan_id) || requestedSince !== null;
  // Activity score from the last ranking (null while the platform is new) sets audit cadence and expansion budget.
  const { data: act } = await admin.from("platform_activity").select("score, phase")
    .eq("product_id", q.product_id).eq("platform", provider).maybeSingle<{ score: number | null; phase: string }>();
  const score = act?.phase === "ranked" ? act.score : null;
  const audit = !isScan && !isLegacySource(provider) && auditDue(q.last_audit_at ? new Date(q.last_audit_at) : null, paid, score, now);
  const leadWindow = windowFor(q, now, paid, requestedSince, audit);
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
  if (!isScan && q.fingerprint && adapter.shareable && q.last_success_at && now.getTime() - new Date(q.last_success_at).getTime() < 10 * 60_000) {
    await logExecution(admin, { q, job, started, status: "covered_by_shared", detail: "Already checked in the last 10 minutes" });
    return { provider, stream: q.stream, skipped: "covered_by_shared" };
  }

  // Shared query registry: one upstream fetch serves every product with the same fingerprint.
  let lockHolder: string | null = null;
  const members: Member[] = [{ q, ctx, rules: await loadRules(admin, q.product_id), window: leadWindow }];
  if (!isScan && q.fingerprint && adapter.shareable) {
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
      const sctx = await loadContext(admin, s.product_id, provider).catch(() => null);
      if (!sctx || sctx.archived) continue;
      if (paid && sctx.paid_allowance_usd <= 0) continue;
      members.push({ q: s, ctx: sctx, rules: await loadRules(admin, s.product_id), window: windowFor(s, now, paid, null, false) });
    }
  }

  const fetchWindow: SearchWindow = {
    since: new Date(Math.min(...members.map((m) => m.window.since.getTime()))),
    until: now,
  };
  const stream = streamsOf(adapter).find((s) => s.id === q.stream) ?? streamsOf(adapter)[0]!;
  const basePages = Number(job.payload.max_pages ?? q.cursor?.pages ?? DEFAULT_MAX_PAGES);
  const maxPages = Math.max(1, Math.min(stream.capabilities.maxPagesPerRun, isLegacySource(provider) ? 5 : 10, basePages + (audit ? 1 : 0)));

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
    const search = await adapter.searchMentions({
      terms: terms.length ? terms : [ctx.name],
      window: fetchWindow,
      maxPages,
      stream: q.stream === "default" ? undefined : q.stream,
      query: q.managed_by === "optimizer" ? q.query : undefined,
      target: { websiteDomain: websiteDomain(ctx.website_url), appStoreId: app?.id ?? null, appStoreCountry: app?.country ?? null },
    }, sctx);

    // Selective comment expansion for platforms without global comment search.
    let expansion: SearchResult | null = null;
    let expandedParents: ExpansionParent[] = [];
    if (adapter.expandComments && !audit) {
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
      const decision = await finishMember(admin, m, provider, job, started, r, search, {
        audit: audit && m.q.id === q.id, sharedWith: members.length,
        expansions: m.q.id === q.id ? expandedParents.length : 0,
        paidRequests: m.q.id === q.id ? paidCalls.length : 0,
        pages: m.q.id === q.id ? search.pagesRequested ?? maxPages : 0,
        nextPages: search.saturated ? Math.min(stream.capabilities.maxPagesPerRun, maxPages + 1) : Math.max(1, maxPages - (audit ? 1 : 0)),
      });
      results.push({ ...r.result, nextIntervalMinutes: decision.intervalMinutes });
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
    // Checkpoints don't move; the next run re-searches the gap (sooner after failures).
    for (const m of members) {
      const failures = m.q.consecutive_failures + 1;
      const interval = m.q.interval_minutes ?? m.ctx.plan_min_minutes;
      await admin.from("monitoring_queries").update({
        consecutive_failures: failures,
        // Budget refusals aren't fixed by retrying sooner.
        next_run_at: (err.kind === "budget" ? nextRunAt(now, interval, 0) : nextRunAt(now, interval, failures)).toISOString(),
        coverage_confidence: failures >= 2 ? "low" : "medium",
        interval_reasons: [err.kind === "budget"
          ? "Paid-source budget reached: checked again at the normal interval"
          : `Retrying sooner after ${failures} failed check${failures === 1 ? "" : "s"}`],
      }).eq("id", m.q.id);
      await logExecution(admin, { q: m.q, job, started, status: "failed", detail: err.message, paidRequests: m.q.id === q.id ? paidCalls.length : 0 });
    }
    throw new MonitorJobError(err, provider, leadWindow, scope);
  } finally {
    if (lockHolder && q.fingerprint) await admin.rpc("svc_release_lock", { p_name: `fp:${q.fingerprint.slice(0, 40)}`, p_holder: lockHolder });
    if (usage.length > 0) {
      await admin.from("api_usage_events").insert(usage.map((u) => ({ ...u, workspace_id: q.workspace_id })));
    }
  }
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

async function finishMember(
  admin: SupabaseClient,
  m: Member,
  provider: PublicSourceId,
  job: JobRow,
  started: Date,
  r: MemberIngest,
  search: SearchResult,
  extra: { audit: boolean; sharedWith: number; expansions: number; paidRequests: number; pages: number; nextPages: number },
): Promise<Schedule> {
  const now = new Date();
  const scope = { workspace_id: m.q.workspace_id, product_id: m.q.product_id };
  await recordCoverage(admin, scope, provider, m.window, r.complete ? "complete" : "partial", r.reasons.join(" ") || null, job.id);
  const prevUntil = m.q.cursor?.until ? new Date(m.q.cursor.until).getTime() : 0;
  // The checkpoint never advances past a run that was cut short (page cap hit, or the
  // plan's mention limit dropped items): the next run re-searches from the old one.
  // Milestone 2 sources keep their original behaviour (always advance, gap recorded).
  const capped = Boolean(search.saturated) || (r.result.overLimit ?? 0) > 0;
  const advance = isLegacySource(provider) || !capped;
  const until = advance ? Math.max(m.window.until.getTime(), prevUntil) : prevUntil;
  const cursor: QueryRow["cursor"] = {
    until: until > 0 ? new Date(until).toISOString() : undefined,
    pages: extra.nextPages,
    audit_missed: extra.audit ? r.auditMissed : m.q.cursor?.audit_missed ?? 0,
  };
  await admin.from("monitoring_queries").update({
    cursor,
    last_run_at: now.toISOString(),
    last_success_at: now.toISOString(),
    consecutive_failures: 0,
    ...(search.saturated ? { last_saturated_at: now.toISOString() } : {}),
    ...(extra.audit ? { last_audit_at: now.toISOString() } : {}),
  }).eq("id", m.q.id);

  // Re-rank the product's platforms with what this run stored (no API calls), then schedule this group.
  const ranking = await refreshActivity(admin, m.q.product_id, { exceptQueryId: m.q.id }).catch((e) => {
    console.error(`[monitor] ranking refresh failed: ${e instanceof Error ? e.message : e}`);
    return null;
  });
  const p = ranking?.get(provider);
  // A search that takes turns with others (keyword rotation) runs in its own time slots.
  const rotation = m.q.params?.rotation ?? null;
  const platformInterval = p?.decision.interval ?? null;
  const d: Schedule = p
    ? {
      intervalMinutes: keywordIntervalMinutes(p.decision.interval, rotation),
      reasons: [...p.assessment.notes, ...p.decision.reasons, ...(rotation ? [rotationReason(rotation, p.decision.interval)] : [])],
      confidence: p.assessment.confidence,
    }
    : { intervalMinutes: m.q.interval_minutes ?? m.ctx.plan_min_minutes, reasons: ["Kept the current interval (ranking unavailable)"], confidence: r.complete ? "medium" : "low" };
  await admin.from("monitoring_queries").update({
    interval_minutes: d.intervalMinutes,
    interval_reasons: d.reasons,
    coverage_confidence: d.confidence,
    next_run_at: (rotation && platformInterval ? rotationNextRun(now, platformInterval, rotation) : nextRunAt(now, d.intervalMinutes, 0)).toISOString(),
  }).eq("id", m.q.id);
  await logExecution(admin, {
    q: m.q, job, started, status: r.complete ? "succeeded" : "partial",
    window: m.window, pages: extra.pages, fetched: r.fetched, relevant: r.relevant, inserted: r.inserted, duplicates: r.duplicates,
    saturated: Boolean(search.saturated), paidRequests: extra.paidRequests, sharedWith: extra.sharedWith, expansions: extra.expansions,
    decision: d, detail: [extra.audit ? `Completeness audit: ${r.auditMissed} missed mention(s) found.` : null, r.reasons.join(" ") || null].filter(Boolean).join(" ") || null,
  });
  return d;
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
