import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronDown, Minus, PackagePlus, Rocket } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, getWorkspaceUsage, hasRole, requireWorkspace } from "@/lib/server/session";
import { getBackfillStatus } from "@/lib/server/collection/backfill-status";
import { loadHistoryFormProps } from "@/lib/server/history-form";
import { HistoryForm } from "@/components/history/history-form";
import { BackfillProgress } from "@/components/history/backfill-progress";
import { getMonitoringOverview, type KeywordCoverageRow, type PlatformMonitoring } from "@/lib/server/collection/monitoring-overview";
import { formatInterval } from "@/lib/sources/adaptive";
import { formatRelative, formatUtc } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/page";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { getKeywordRankings, type KeywordRankings } from "@/lib/server/collection/keyword-rankings";
import { parseRange } from "@/lib/domain/date-range";
import { COVERAGE_LABEL, type CoverageStatus, type KeywordPerformance } from "@/lib/analytics/keyword-ranking";
import { BoostForm, CancelBoost, RankingTable, SourceToggle, type RankingRow } from "./monitoring-client";

export const metadata: Metadata = { title: "Smart Monitoring" };

/** Request time (kept outside render bodies for the purity lint rule). */
function requestTime() {
  return Date.now();
}

const STATE: Record<string, { tone: RankingRow["stateTone"]; label: string }> = {
  live: { tone: "positive", label: "Monitoring" },
  partial: { tone: "warning", label: "Monitoring · incomplete" },
  failing: { tone: "negative", label: "Problem" },
  not_started: { tone: "info", label: "Waiting for first check" },
};

function toRow(p: PlatformMonitoring, now: number, planName: string, planMin: number, paidNote: string | null): RankingRow {
  const r = p.ranking;
  const st = STATE[p.state] ?? STATE.not_started!;
  const next = p.nextScanAt ? new Date(p.nextScanAt).getTime() : null;
  return {
    id: p.id, name: p.name, paid: p.paid,
    rank: r?.phase === "ranked" ? r.rank : null,
    learning: !r || r.phase === "discovery",
    score: r?.phase === "ranked" ? r.score : null,
    sharePct: r?.phase === "ranked" && r.importanceShare !== null ? Math.round(r.importanceShare * 100) : null,
    arrivalPerDay: r?.arrivalPerDay ?? null,
    risk: r?.risk ?? null,
    riskDetail: r?.riskDetail ?? null,
    mentions7d: p.mentions7d,
    trend: r?.trend ?? "new",
    growthPct: r?.growthPct ?? null,
    interval: p.intervalMinutes ? formatInterval(p.intervalMinutes) : "—",
    // Effective keyword refresh (platform interval × rotation turns), shown when it differs from the platform's.
    keywordInterval: p.keywordIntervals && p.intervalMinutes && p.keywordIntervals.max !== p.intervalMinutes
      ? (p.keywordIntervals.min === p.keywordIntervals.max ? formatInterval(p.keywordIntervals.max)
        : `${formatInterval(p.keywordIntervals.min)} – ${formatInterval(p.keywordIntervals.max)}`)
      : null,
    keywordConflict: p.keywordConflict,
    next: next === null ? "—" : next <= now ? "Due now" : formatRelative(new Date(next), new Date(now)),
    nextUtc: p.nextScanAt ? formatUtc(p.nextScanAt) : null,
    last: p.lastScanAt ? formatRelative(new Date(p.lastScanAt), new Date(now)) : "Not yet",
    lastUtc: p.lastScanAt ? formatUtc(p.lastScanAt) : null,
    confidence: p.confidence,
    completeSharePct: p.completeShare === null ? null : Math.round(p.completeShare * 100),
    incomplete: p.confidence !== "high" || p.state === "partial" || p.state === "failing",
    stateLabel: st.label, stateTone: st.tone, stateDetail: p.state !== "live" ? p.stateDetail ?? null : null,
    rankText: r?.rankText ?? `${p.name} hasn't been scored yet. It is ranked after its first checks.`,
    intervalText: r?.intervalText ?? null,
    components: (r?.components ?? []).map((c) => ({ id: c.id, label: c.label, points: c.points, measured: c.value !== null, detail: c.detail })),
    reasons: p.reasons,
    // The plan limit is already in the explanation when it sets the interval.
    planNote: [r?.planLimited ? null : `Your ${planName} plan checks each platform at most every ${formatInterval(planMin)}.`, p.paid ? paidNote : null]
      .filter(Boolean).join(" ") || null,
    discovery: p.discovery ? `About ${formatInterval(p.discovery.typical)} typically, at most ${formatInterval(p.discovery.worst)}` : null,
    saturated: p.saturatedRecently,
    failures: p.failures,
    keywords: p.keywords,
    toggle: Boolean(p.toggle),
  };
}

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  if (!product) {
    return (
      <>
        <PageHeader title="Smart Monitoring" />
        <EmptyState icon={PackagePlus} title="Add a product first" action={{ href: "/onboarding/product", label: "Add product" }}>
          Monitoring runs per product.
        </EmptyState>
      </>
    );
  }
  const canEdit = hasRole(workspace.role, "admin");
  const range = parseRange(await searchParams, new Date());
  const [o, backfill, usage] = await Promise.all([
    getMonitoringOverview(product.id, workspace.id),
    getBackfillStatus(product.id),
    getWorkspaceUsage(workspace.id),
  ]);
  const k = await getKeywordRankings(await createClient(), product.id, o, range);
  const backfillActive = Boolean(backfill && ["queued", "searching", "paused"].includes(backfill.status));
  const historyForm = canEdit && !backfillActive ? await loadHistoryFormProps(product.id) : null;
  const now = requestTime();
  const runnable = (p: PlatformMonitoring) => p.groups > 0 && p.state !== "not_configured" && p.state !== "not_enabled";
  const active = o.platforms.filter(runnable);
  const available = o.platforms.filter((p) => !runnable(p));
  const paidNote = o.paid.allowanceUsedPercent !== null ? `Paid-source allowance used this month: ${o.paid.allowanceUsedPercent}%.` : null;
  const rows = active.map((p) => toRow(p, now, o.plan.name, o.plan.minIntervalMinutes, paidNote));
  const boosts = o.boosts.filter((b) => !b.canceled_at && new Date(b.ends_at).getTime() > now);
  const pastBoosts = o.boosts.filter((b) => b.canceled_at || new Date(b.ends_at).getTime() <= now).slice(0, 5);
  const eff = o.summary.efficiency;
  const conflicts = active.filter((p) => p.keywordConflict).map((p) => ({ id: p.id, text: p.keywordConflict! }));
  const pausedKeywords = o.keywordCoverage.filter((k) => k.paused).length;

  const lastScan = active.map((p) => p.lastScanAt).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  const nextScan = active.map((p) => p.nextScanAt).filter((x): x is string => Boolean(x)).sort()[0] ?? null;
  const unsearchable = o.keywordCoverage.flatMap((kw) => kw.platforms.filter((p) => p.intervalMinutes === null).map((p) => `“${kw.term}” can't be searched on ${p.name}: ${p.detail}`));
  const warnings = [
    ...(o.allowancePausedUntil ? [`This month's mention allowance is used up: paid platforms are paused and free ones are checked at most daily until ${formatUtc(o.allowancePausedUntil)}. New mentions are held, not discarded.`] : []),
    ...active.filter((p) => p.state === "failing" || p.state === "partial").map((p) => `${p.name}: ${p.stateDetail ?? (p.state === "failing" ? "checks are failing" : "not every result could be read")}`),
    ...conflicts.map((c) => c.text),
    ...(pausedKeywords > 0 ? [`${pausedKeywords} keyword${pausedKeywords === 1 ? " is" : "s are"} paused: over your ${o.plan.name} plan's keyword allowance (${o.plan.maxKeywords} active per workspace).`] : []),
    ...unsearchable,
  ];
  const monitoredKeywords = o.keywordCoverage.filter((kw) => !kw.paused).length;
  const periodLabel = range.label.toLowerCase();

  return (
    <>
      <PageHeader
        title="Smart Monitoring"
        description="Every keyword is searched on every platform that supports it. Platforms are ranked by how many mentions they bring in, and busier keyword × platform searches are checked more often."
      />
      <div className="grid gap-6">
        <section aria-labelledby="summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <h2 id="summary" className="sr-only">Monitoring summary</h2>
          <Stat label={`Total mentions · ${periodLabel}`} value={k.totalMentions.toLocaleString("en-US")} hint="Relevant, duplicates excluded" />
          <Stat label="Active platforms" value={String(active.length)} />
          <Stat label="Keywords monitored" value={String(monitoredKeywords)} hint={pausedKeywords ? `${pausedKeywords} paused` : undefined} />
          <Stat label="Last scan" value={lastScan ? formatRelative(new Date(lastScan), new Date(now)) : "Not yet"} hint={lastScan ? formatUtc(lastScan) : undefined} />
          <Stat label="Next scan" value={!nextScan ? "—" : new Date(nextScan).getTime() <= now ? "Due now" : formatRelative(new Date(nextScan), new Date(now))} hint={nextScan ? formatUtc(nextScan) : undefined} />
          <Stat label="Coverage warnings" value={String(warnings.length)} hint={warnings.length ? "See below" : "None"} />
        </section>

        {warnings.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-[13px]" role="note" aria-labelledby="warnings-title">
            <p id="warnings-title" className="mb-1 flex items-center gap-1.5 font-medium"><AlertTriangle className="size-4 text-warning" aria-hidden />Coverage warnings</p>
            <ul className="grid gap-1 text-xs" aria-label="Coverage warnings">
              {warnings.slice(0, 8).map((w) => <li key={w}>{w}</li>)}
              {warnings.length > 8 && <li className="text-muted-foreground">…and {warnings.length - 8} more in Advanced details.</li>}
            </ul>
            {o.allowancePausedUntil && <Link href="/settings/billing" className="mt-1 inline-block text-xs underline">Plan &amp; usage</Link>}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Keyword performance</CardTitle>
            <CardDescription>
              Relevant mentions per keyword, {periodLabel}, ranked by count. Open a keyword to see its platforms ranked by mentions.
              {k.observedOnly && " Based on observed mentions: some platforms are still being scanned or weren't fully covered."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {k.keywords.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No keywords yet. Add them in <Link href="/settings/products" className="underline">product settings</Link>.</p>
            ) : <KeywordList rows={k.keywords} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Overall platform performance</CardTitle>
            <CardDescription>
              Platforms ranked by unique relevant mentions, {periodLabel}. A mention that matches several keywords counts once here.
              Growth compares with the period of the same length just before and doesn&apos;t affect rank. Change the period with the date range at the top.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {k.platforms.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Nothing is monitored yet. Add keywords in <Link href="/settings/products" className="underline">product settings</Link>.
              </p>
            ) : <PlatformTable rows={k.platforms} now={now} />}
          </CardContent>
        </Card>

        <details className="group rounded-lg border bg-surface" id="advanced">
          <summary className="flex cursor-pointer items-center justify-between gap-2 p-4 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
            Advanced details
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="grid gap-6 border-t p-4">
            <div className="grid gap-1 text-xs text-muted-foreground">
              <p>
                How checks are scheduled: SignalForge measures, for this product alone, how fast relevant mentions arrive on each keyword × platform
                search and how fast each search fills one check&apos;s results. Busier searches are checked more often; quiet ones are still checked
                at least once a day, so new mentions there are found too. Intervals shorten at once when activity rises and lengthen only gradually, never
                while coverage is incomplete. Your {o.plan.name} plan checks each platform at most every {formatInterval(o.plan.minIntervalMinutes)} and
                targets searching every keyword within {formatInterval(o.plan.keywordTargetMinutes)}.
                {o.paid.includedInPlan ? " Paid sources are included in your plan." : ""}{paidNote ? ` ${paidNote}` : ""}
              </p>
              {o.plan.devFloorMinutes !== null && (
                <p className="text-warning">
                  Development entitlement active on this server: this workspace may be checked as often as every {formatInterval(o.plan.devFloorMinutes)}.
                  API budgets, paid allowances and rate limits still apply. Not available in production.
                </p>
              )}
            </div>

            <section aria-labelledby="diag-summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <h3 id="diag-summary" className="sr-only">Scheduling, last 7 days</h3>
              <Stat label="Checks completed (7 days)" value={eff.checks.toLocaleString("en-US")} />
              <Stat
                label="Checks avoided vs hourly"
                value={eff.percentFewer === null ? "—" : `${eff.percentFewer}%`}
                hint={eff.percentFewer === null
                  ? "Shown after 24 h and 3 checks of monitoring history"
                  : `${eff.avoided.toLocaleString("en-US")} of ${eff.hourlyBaseline.toLocaleString("en-US")} hourly checks, over the time each platform was monitored`}
              />
              <Stat
                label="Avg. discovery delay"
                value={o.summary.avgDiscoveryMinutes === null ? "—" : `~${formatInterval(o.summary.avgDiscoveryMinutes)}`}
                hint="Typical time before a new public mention appears (estimate)"
              />
              <Stat label="Interval adjustments (7 days)" value={String(o.summary.intervalChanges7d)} />
            </section>

            <div className="grid gap-2">
              <h3 className="text-[13px] font-medium">Platform diagnostics</h3>
              <p className="text-xs text-muted-foreground">Rank here uses the last 4 weeks of relevant mentions. Open a platform for the reasons behind its interval.</p>
              {rows.length === 0 ? <p className="text-[13px] text-muted-foreground">Nothing is monitored yet.</p> : <RankingTable rows={rows} productId={product.id} canEdit={canEdit} />}
            </div>

            <div className="grid gap-2">
              <h3 className="text-[13px] font-medium">Keyword schedule</h3>
              <p className="text-xs text-muted-foreground">
                Where a platform can&apos;t run all its searches each check, keywords take turns and keep their own checkpoints, so each turn
                re-searches everything since the last one. Your {o.plan.name} plan includes {o.plan.maxKeywords} active keyword{o.plan.maxKeywords === 1 ? "" : "s"} per workspace.
              </p>
              {conflicts.length > 0 && (
                <ul className="grid gap-1 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs" aria-label="Keyword schedule conflicts">
                  {conflicts.map((c) => <li key={c.id}>{c.text}</li>)}
                </ul>
              )}
              {o.keywordCoverage.length > 0 && <KeywordCoverageList rows={o.keywordCoverage} />}
            </div>
          </div>
        </details>

        <Card id="history">
          <CardHeader>
            <CardTitle>Historical search</CardTitle>
            <CardDescription>
              Collected separately from ongoing monitoring, in resumable steps. Platforms that can&apos;t search as far back say so; a
              platform that can&apos;t expose everything is marked partially collected, never complete.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {backfill && (
              <BackfillProgress status={backfill} allowanceRemaining={usage?.mentionsRemaining ?? null} renewsOn={usage ? usage.periodEnd.slice(0, 10) : null} />
            )}
            {historyForm && (backfill ? (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-[13px] font-medium">Search a different period</summary>
                <div className="mt-3"><HistoryForm {...historyForm} /></div>
              </details>
            ) : <HistoryForm {...historyForm} />)}
            {!backfill && !historyForm && <p className="text-[13px] text-muted-foreground">No historical search has run for this product. Workspace admins can start one.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>More platforms</CardTitle>
            <CardDescription>
              {o.paid.serverEnabled
                ? "Paid platforms use SignalForge's paid data provider and count toward your plan's paid-source allowance."
                : "Paid platforms are switched off on this server until spending limits are configured."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2" aria-label="Other platforms">
              {available.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3">
                  <div className="grid gap-0.5">
                    <span className="flex items-center gap-1.5 text-[13px] font-medium">{p.name}{p.paid && <Badge>Paid</Badge>}</span>
                    <span className="text-xs text-muted-foreground">{p.toggle?.reason ?? p.stateDetail ?? "Not monitored"}</span>
                  </div>
                  {canEdit && p.toggle && p.toggle.allowed && (
                    <SourceToggle productId={product.id} platform={p.id} name={p.name} enabled={false} paid={p.paid} />
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><Rocket className="size-4" aria-hidden />Launch Boost</CardTitle>
            <CardDescription>
              Check selected platforms more often around a launch, update or campaign. Monitoring returns to automatic intervals when the boost ends.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {boosts.length > 0 && (
              <ul className="grid gap-2" aria-label="Active and upcoming boosts">
                {boosts.map((b) => {
                  const live = new Date(b.starts_at).getTime() <= now;
                  return (
                    <li key={b.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3">
                      <div className="grid gap-0.5 text-[13px]">
                        <span className="flex items-center gap-1.5 font-medium">{b.title}<Badge tone={live ? "positive" : "info"}>{live ? "Active" : "Scheduled"}</Badge></span>
                        <span className="text-xs text-muted-foreground">
                          {b.platforms.map((x) => o.platforms.find((p) => p.id === x)?.name ?? x).join(", ")} · until {formatUtc(b.ends_at)}
                          {b.max_paid_checks > 0 && ` · up to ${b.max_paid_checks} paid checks`}
                        </span>
                      </div>
                      {canEdit && <CancelBoost productId={product.id} boostId={b.id} />}
                    </li>
                  );
                })}
              </ul>
            )}
            {canEdit ? (
              <BoostForm
                productId={product.id}
                platforms={active.map((p) => ({ id: p.id, name: p.name, paid: p.paid }))}
                maxPaidChecks={o.paid.maxBoostPaidChecks}
                boostMinHours={Math.round(o.paid.boostMinMinutes / 60)}
              />
            ) : (
              <p className="text-[13px] text-muted-foreground">Only workspace admins can schedule boosts.</p>
            )}
            {pastBoosts.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Recent: {pastBoosts.map((b) => `${b.title} (${b.canceled_at ? "canceled" : "ended"} ${formatRelative(b.canceled_at ?? b.ends_at)})`).join(" · ")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

const KIND_LABEL: Record<string, string> = {
  exact_name: "Product name", domain: "Domain", handle: "Handle", custom: "Phrase", abbreviation: "Abbreviation", misspelling: "Spelling variant",
};

function KeywordCoverageList({ rows }: { rows: KeywordCoverageRow[] }) {
  return (
    <ul className="divide-y rounded-md border" aria-label="Keyword coverage">
      {rows.map((k) => {
        const searched = k.platforms.filter((p) => p.intervalMinutes !== null);
        const missing = k.platforms.filter((p) => p.intervalMinutes === null);
        const intervals = searched.map((p) => p.intervalMinutes!);
        const fastest = intervals.length ? Math.min(...intervals) : null;
        const slowest = intervals.length ? Math.max(...intervals) : null;
        const rotating = searched.some((p) => p.status === "rotating");
        if (k.paused) {
          return (
            <li key={k.term} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[13px]">
              <span className="font-medium">{k.term}</span>
              <Badge>{KIND_LABEL[k.kind] ?? k.kind}</Badge>
              <Badge tone="warning">Paused — over your plan&apos;s keyword allowance</Badge>
            </li>
          );
        }
        return (
          <li key={k.term}>
            <details className="group">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[13px] [&::-webkit-details-marker]:hidden">
                <span className="font-medium">{k.term}</span>
                <Badge>{KIND_LABEL[k.kind] ?? k.kind}</Badge>
                <span className="text-xs text-muted-foreground">
                  Searched on {searched.length} of {k.platforms.length} platform{k.platforms.length === 1 ? "" : "s"}
                </span>
                {fastest !== null && (
                  <span className="text-xs tabular">
                    Every {formatInterval(fastest)}{slowest !== fastest ? ` – ${formatInterval(slowest!)}` : ""}
                  </span>
                )}
                {rotating && <Badge tone="info">Takes turns on some platforms</Badge>}
                {missing.length > 0 && <Badge tone="warning">Not searchable on {missing.length}</Badge>}
              </summary>
              <ul className="grid gap-1 px-3 pb-3 text-xs sm:grid-cols-2" aria-label={`${k.term} by platform`}>
                {k.platforms.map((p) => (
                  <li key={p.platform} className="flex items-start justify-between gap-3 rounded border px-2 py-1.5">
                    <span className="grid gap-0.5">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground">
                        {p.status === "covered" || p.status === "duplicate" ? `Found by the "${p.via}" search` : p.detail}
                      </span>
                    </span>
                    <span className={p.intervalMinutes === null ? "shrink-0 text-warning" : "shrink-0 tabular"} title={p.scheduled ? "From this search's schedule" : "Estimated: not scheduled yet"}>
                      {p.intervalMinutes === null ? "Not searched" : `every ${formatInterval(p.intervalMinutes)}${p.scheduled ? "" : " (est.)"}`}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="grid content-start gap-0.5 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </Card>
  );
}

const STATUS_TONE: Record<CoverageStatus, "positive" | "info" | "warning" | "neutral"> = {
  monitored: "positive", learning: "info", partial: "warning", not_scanned: "neutral",
};

function StatusBadge({ status }: { status: CoverageStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{COVERAGE_LABEL[status]}</Badge>;
}

function Growth({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-muted-foreground" title="No comparable earlier period (not monitored then, or nothing found)">—</span>;
  const Icon = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs tabular text-muted-foreground">
      <Icon className="size-3.5" aria-hidden />{pct > 0 ? "+" : ""}{pct}%
    </span>
  );
}

/** One single-hue magnitude bar: length = this platform's share of the keyword's mentions. */
function ShareBar({ pct }: { pct: number | null }) {
  return (
    <span className="block h-1.5 w-full rounded-full bg-muted" aria-hidden>
      <span className="block h-1.5 rounded-full bg-primary" style={{ width: `${pct ?? 0}%` }} />
    </span>
  );
}

function KeywordList({ rows }: { rows: KeywordPerformance[] }) {
  return (
    <ul className="divide-y rounded-md border" aria-label="Keyword performance">
      {rows.map((kw) => {
        const scanned = kw.platforms.filter((p) => p.mentions !== null && p.mentions > 0);
        const distribution = scanned.slice(0, 3).map((p) => `${p.name} ${p.sharePct}%`).join(" · ") + (scanned.length > 3 ? ` · +${scanned.length - 3} more` : "");
        return (
          <li key={kw.term}>
            <details className="group">
              <summary className="grid cursor-pointer grid-cols-[1.5rem_1fr_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2.5 text-[13px] [&::-webkit-details-marker]:hidden sm:grid-cols-[1.5rem_minmax(8rem,1fr)_6rem_minmax(8rem,1fr)_4rem_1rem]">
                <span className="tabular text-xs text-muted-foreground">{kw.rank ?? "–"}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{kw.term}</span>
                  {kw.kind === "exact_name" && <Badge>Brand</Badge>}
                  {kw.paused && <Badge tone="warning">Paused</Badge>}
                </span>
                <span className="text-right tabular">
                  {kw.paused ? "—" : kw.mentions === null ? <span className="text-xs text-muted-foreground">Not scanned yet</span> : `${kw.mentions.toLocaleString("en-US")} mentions`}
                </span>
                <span className="col-span-2 col-start-2 truncate text-xs text-muted-foreground sm:col-span-1 sm:col-start-auto">
                  {kw.paused ? "Over your plan's keyword allowance" : kw.best ? <>Best: <span className="text-foreground">{kw.best.name}</span>{distribution ? ` · ${distribution}` : ""}</> : kw.mentions === 0 ? "No mentions found yet" : "Waiting for first scan"}
                </span>
                <span className="hidden text-right sm:block"><Growth pct={kw.growthPct} /></span>
                <ChevronDown className="hidden size-4 text-muted-foreground transition-transform group-open:rotate-180 sm:block" aria-hidden />
              </summary>
              {kw.paused ? (
                <p className="px-3 pb-3 text-xs text-muted-foreground">Kept, not searched. Turn another keyword off or change plan to monitor it.</p>
              ) : kw.platforms.length === 0 ? (
                <p className="px-3 pb-3 text-xs text-muted-foreground">No monitored platform can search this keyword. See Advanced details.</p>
              ) : (
                <ol className="grid gap-1.5 px-3 pb-3" aria-label={`${kw.term} platform ranking`}>
                  {kw.platforms.map((p) => (
                    <li key={p.id} className="grid grid-cols-[1.5rem_minmax(6rem,10rem)_1fr_auto] items-center gap-3 text-xs">
                      <span className="tabular text-muted-foreground">{p.rank ? `${p.rank}.` : "–"}</span>
                      <span className="truncate font-medium">{p.name}</span>
                      <ShareBar pct={p.sharePct} />
                      <span className="flex items-center justify-end gap-2 tabular">
                        {p.mentions === null ? <StatusBadge status="not_scanned" /> : <>{p.mentions.toLocaleString("en-US")}{p.status !== "monitored" && <StatusBadge status={p.status} />}</>}
                        <Growth pct={p.growthPct} />
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function PlatformTable({ rows, now }: { rows: KeywordRankings["platforms"]; now: number }) {
  const next = (p: KeywordRankings["platforms"][number]["platform"]) =>
    !p.nextScanAt ? "—" : new Date(p.nextScanAt).getTime() <= now ? "Due now" : formatRelative(new Date(p.nextScanAt), new Date(now));
  return (
    <>
      <table className="hidden w-full text-[13px] md:table" aria-label="Overall platform performance">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="w-8 py-1.5 font-medium">#</th>
            <th scope="col" className="font-medium">Platform</th>
            <th scope="col" className="text-right font-medium">Mentions</th>
            <th scope="col" className="w-40 pl-4 font-medium">Share</th>
            <th scope="col" className="text-right font-medium">Growth</th>
            <th scope="col" className="pl-4 font-medium">Refresh</th>
            <th scope="col" className="font-medium">Next scan</th>
            <th scope="col" className="font-medium">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="py-2 tabular text-muted-foreground">{r.rank ?? "–"}</td>
              <td className="font-medium">{r.name}</td>
              <td className="text-right tabular">{r.mentions === null ? "—" : r.mentions.toLocaleString("en-US")}</td>
              <td className="pl-4"><span className="flex items-center gap-2"><ShareBar pct={r.sharePct} /><span className="w-9 shrink-0 text-right text-xs tabular text-muted-foreground">{r.sharePct === null ? "" : `${r.sharePct}%`}</span></span></td>
              <td className="text-right"><Growth pct={r.growthPct} /></td>
              <td className="pl-4 tabular">{r.platform.intervalMinutes ? `every ${formatInterval(r.platform.intervalMinutes)}` : "—"}</td>
              <td className="tabular" title={r.platform.nextScanAt ? formatUtc(r.platform.nextScanAt) : undefined}>{next(r.platform)}</td>
              <td><StatusBadge status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="grid gap-2 md:hidden" aria-label="Overall platform performance">
        {rows.map((r) => (
          <li key={r.id} className="grid gap-1.5 rounded-md border p-3 text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium"><span className="mr-1.5 tabular text-muted-foreground">{r.rank ?? "–"}</span>{r.name}</span>
              <StatusBadge status={r.status} />
            </div>
            <div className="flex items-center gap-2"><ShareBar pct={r.sharePct} /><span className="shrink-0 tabular">{r.mentions === null ? "—" : r.mentions.toLocaleString("en-US")}{r.sharePct !== null && ` · ${r.sharePct}%`}</span></div>
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <Growth pct={r.growthPct} />
              <span>{r.platform.intervalMinutes ? `Every ${formatInterval(r.platform.intervalMinutes)}` : "Not scheduled"} · next {next(r.platform)}</span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
