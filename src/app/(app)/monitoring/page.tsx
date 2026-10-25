import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronDown, Minus, PackagePlus, Pause } from "lucide-react";
import { StopScan } from "@/components/scan/stop-scan";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, getWorkspaceUsage, hasRole, requireWorkspace } from "@/lib/server/session";
import { getBackfillStatus } from "@/lib/server/collection/backfill-status";
import { loadHistoryFormProps } from "@/lib/server/history-form";
import { HistoryForm } from "@/components/history/history-form";
import { BackfillProgress } from "@/components/history/backfill-progress";
import { getMonitoringOverview, type KeywordCoverageRow, type PlatformMonitoring } from "@/lib/server/collection/monitoring-overview";
import { formatInterval } from "@/lib/sources/adaptive";
import { formatRelative, formatTime } from "@/lib/format";
import { AutoRefresh, RelativeTime } from "@/components/time";
import { getTimeZone } from "@/lib/server/timezone";
import { EmptyState, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/primitives";
import { CountUp } from "@/components/motion";
import { getKeywordRankings, type KeywordRankings } from "@/lib/server/collection/keyword-rankings";
import { parseRange } from "@/lib/domain/date-range";
import type { KeywordPerformance } from "@/lib/analytics/keyword-ranking";
import { RankingTable, type RankingRow } from "./monitoring-client";

export const metadata: Metadata = { title: "Monitoring" };

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

function toRow(p: PlatformMonitoring, now: number, planName: string, planMin: number, paidNote: string | null, at: (d: string) => string): RankingRow {
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
    nextAt: p.nextScanAt ? at(p.nextScanAt) : null,
    last: p.lastScanAt ? formatRelative(new Date(p.lastScanAt), new Date(now)) : "Not yet",
    lastAt: p.lastScanAt ? at(p.lastScanAt) : null,
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
  const tz = await getTimeZone();
  const at = (d: string | Date) => formatTime(d, tz);
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  if (!product) {
    return (
      <>
        <PageHeader title="Monitoring" />
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
  const sb = await createClient();
  const [k, { data: scan }] = await Promise.all([
    getKeywordRankings(sb, product.id, o, range),
    sb.from("products").select("scan_paused_at").eq("id", product.id).maybeSingle(),
  ]);
  const stoppedAt = (scan?.scan_paused_at as string | null) ?? null;
  const backfillActive = Boolean(backfill && ["queued", "searching", "paused"].includes(backfill.status));
  const historyForm = canEdit && !backfillActive ? await loadHistoryFormProps(product.id) : null;
  const now = requestTime();
  const runnable = (p: PlatformMonitoring) => p.groups > 0 && p.state !== "not_configured" && p.state !== "not_enabled";
  const active = o.platforms.filter(runnable);
  // One identity colour per platform, in mention order (same palette as Trends).
  const ENTITY = ["var(--entity-1)", "var(--entity-2)", "var(--entity-3)", "var(--entity-4)", "var(--entity-5)", "var(--entity-6)"];
  const colorOf = new Map(platformOrder(k).map((id, i) => [id, ENTITY[i] ?? "color-mix(in oklab, var(--foreground) 25%, transparent)"]));
  const paidNote = o.paid.allowanceUsedPercent !== null ? `Paid-source allowance used this month: ${o.paid.allowanceUsedPercent}%.` : null;
  const rows = active.map((p) => toRow(p, now, o.plan.name, o.plan.minIntervalMinutes, paidNote, at));
  const eff = o.summary.efficiency;
  const pausedKeywords = o.keywordCoverage.filter((k) => k.paused).length;

  const lastScan = active.map((p) => p.lastScanAt).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  const nextScan = active.map((p) => p.nextScanAt).filter((x): x is string => Boolean(x)).sort()[0] ?? null;
  const monitoredKeywords = o.keywordCoverage.filter((kw) => !kw.paused).length;
  const periodLabel = range.label.toLowerCase();

  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 pb-10">
        {/* Hero: what's being watched, whether scanning runs, and the period's catch. */}
        <section className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="rise grid content-start gap-5">
            <div className="grid gap-1.5">
              <h1 className="text-[34px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]">Monitoring</h1>
              <p className="max-w-[60ch] text-[14px] text-muted-foreground">
                Every keyword is searched on every platform that supports it. Busier keyword × platform searches are checked more often; quiet ones at least daily.
              </p>
            </div>
            <div className="grid gap-2">
              <span className="text-[13px] text-muted-foreground">{`Total mentions · ${periodLabel}`}</span>
              <CountUp value={k.totalMentions} className="text-[56px] font-semibold leading-none tracking-[-0.045em] sm:text-[64px]" />
              <span className="text-[12px] text-muted-foreground/80">Relevant, duplicates excluded</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`panel flex h-9 items-center gap-2 rounded-full px-4 text-[13px] ${stoppedAt ? "text-warning" : ""}`}>
                <span className={`size-2 rounded-full ${stoppedAt ? "bg-warning" : "breathe bg-positive"}`} aria-hidden />
                {stoppedAt ? "Scanning stopped" : "Scanning live"}
              </span>
              {canEdit && <StopScan productId={product.id} productName={product.name} stopped={Boolean(stoppedAt)} />}
            </div>
          </div>
          <section aria-labelledby="summary" className="rise grid grid-cols-2 gap-3 self-end sm:grid-cols-4 xl:grid-cols-2" style={{ ["--d" as string]: "120ms" }}>
            <h2 id="summary" className="sr-only">Monitoring summary</h2>
            <Stat i={0} label="Active platforms" value={String(active.length)} hint="Searched for this product" />
            <Stat i={1} label="Keywords monitored" value={String(monitoredKeywords)} hint={pausedKeywords ? `${pausedKeywords} paused` : "All active"} />
            <Stat i={2} label="Last scan" value={lastScan ? <RelativeTime value={new Date(lastScan).toISOString()} /> : "Not yet"} hint={lastScan ? at(lastScan) : undefined} />
            <Stat i={3} label="Next scan" value={stoppedAt ? "Stopped" : !nextScan ? "—" : <RelativeTime value={new Date(nextScan).toISOString()} dueLabel="Due now" />} hint={nextScan ? at(nextScan) : undefined} />
          </section>
        </section>

        {stoppedAt && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-warning/40 bg-warning/5 p-4 text-[13px]" role="status" data-testid="scan-stopped">
            <Pause className="size-4 text-warning" aria-hidden />
            <span><span className="font-medium">Scanning is stopped</span> since {at(stoppedAt)}. No platform is searched for {product.name} or its competitors; collected data is kept.
              {!canEdit && " A workspace admin can resume it."}</span>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 xl:grid-cols-12">
          <section className="panel rise grid min-w-0 content-start gap-4 rounded-[18px] p-5 xl:col-span-7" style={{ ["--d" as string]: "200ms" }}>
            <div className="grid gap-1">
              <h2 className="text-[13px] text-muted-foreground">Keyword performance</h2>
              <p className="text-[12px] text-muted-foreground/80">
                Relevant mentions per keyword, {periodLabel}, and which platforms they come from. Open a keyword for its platform ranking.
              </p>
            </div>
            {k.keywords.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No keywords yet. Add them in <Link href="/settings/products" className="underline">product settings</Link>.</p>
            ) : <KeywordList rows={k.keywords} colorOf={colorOf} />}
          </section>
          <section className="panel rise grid min-w-0 content-start gap-4 rounded-[18px] p-5 xl:col-span-5" style={{ ["--d" as string]: "260ms" }}>
            <div className="grid gap-1">
              <h2 className="text-[13px] text-muted-foreground">Where mentions come from</h2>
              <p className="text-[12px] text-muted-foreground/80">Unique relevant mentions by platform, {periodLabel}.</p>
            </div>
            <PlatformDonut rows={k.platforms} total={k.totalMentions} colorOf={colorOf} />
          </section>
        </div>

        <section className="panel rise grid content-start gap-4 rounded-[18px] p-5" style={{ ["--d" as string]: "320ms" }}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="grid gap-1">
              <h2 className="text-[13px] text-muted-foreground">Scan schedule</h2>
              <p className="text-[12px] text-muted-foreground/80">When each platform is checked next, over the coming 24 hours. Busier platforms are checked more often.</p>
            </div>
            {stoppedAt && <Badge tone="warning">Scanning stopped</Badge>}
          </div>
          <ScanTimeline rows={k.platforms} now={now} stopped={Boolean(stoppedAt)} at={at} />
        </section>

        <section className="panel rise grid content-start gap-4 rounded-[18px] p-5" style={{ ["--d" as string]: "380ms" }}>
          <div className="grid gap-1">
            <h2 className="text-[13px] text-muted-foreground">Overall platform performance</h2>
            <p className="max-w-[90ch] text-[12px] text-muted-foreground/80">
              Platforms ranked by unique relevant mentions, {periodLabel}. A mention that matches several keywords counts once here.
              Growth compares with the period of the same length just before and doesn&apos;t affect rank.
            </p>
          </div>
          {k.platforms.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Nothing is monitored yet. Add keywords in <Link href="/settings/products" className="underline">product settings</Link>.
            </p>
          ) : <PlatformTable rows={k.platforms} now={now} stopped={Boolean(stoppedAt)} at={at} colorOf={colorOf} />}
        </section>

        {/* How checking works: shown as part of the page, in three steps instead of a paragraph. */}
        <section className="panel rise grid gap-6 rounded-[18px] p-5 sm:p-6" id="advanced" style={{ ["--d" as string]: "420ms" }}>
          <div className="grid gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="grid gap-1">
                <h2 className="text-[20px] font-medium tracking-[-0.02em]">How checking works</h2>
                <p className="text-[12px] text-muted-foreground">Measured for this product alone, per keyword × platform search.</p>
              </div>
              <span className="panel flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px]">
                <span className="size-1.5 rounded-full bg-foreground" aria-hidden />
                Your {o.plan.name} plan checks each platform at most every {formatInterval(o.plan.minIntervalMinutes)}
              </span>
            </div>
            <ol className="grid gap-3 md:grid-cols-3">
              {[
                { n: "1", title: "Measure", text: "How fast relevant mentions arrive on each search, and how fast one check fills up." },
                { n: "2", title: "Busy → more often", text: "Intervals shorten at once when activity rises; they lengthen only slowly, to avoid noise." },
                { n: "3", title: "Quiet → still daily", text: "Quiet searches are checked at least once a day, so nothing new is missed." },
              ].map((x) => (
                <li key={x.n} className="grid content-start gap-1.5 rounded-2xl bg-foreground/[0.03] p-4">
                  <span className="flex items-center gap-2 text-[13px] font-medium">
                    <span className="flex size-6 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">{x.n}</span>{x.title}
                  </span>
                  <span className="text-[12px] leading-relaxed text-muted-foreground">{x.text}</span>
                </li>
              ))}
            </ol>
            {o.plan.devFloorMinutes !== null && (
              <p className="text-[12px] text-warning">
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
              <h3 className="text-[15px] font-medium">Platforms, ranked</h3>
              <p className="text-[12px] text-muted-foreground">Last 4 weeks of relevant mentions. Open a platform to see why it ranks and is checked as it is.</p>
              {rows.length === 0 ? <p className="text-[13px] text-muted-foreground">Nothing is monitored yet.</p> : <RankingTable rows={rows} />}
            </div>

            <div className="grid gap-2">
              <h3 className="text-[15px] font-medium">Keyword schedule</h3>
              <p className="text-[12px] text-muted-foreground">
                How often each keyword is searched on each platform. When keywords take turns, each turn catches up from where it left off · {o.plan.name}: {o.plan.maxKeywords} keyword{o.plan.maxKeywords === 1 ? "" : "s"}.
              </p>
              {o.keywordCoverage.length > 0 && <KeywordCoverageList rows={o.keywordCoverage} />}
            </div>

        </section>

        {/* Historical search: offered once (skipped during onboarding); shown while it runs, gone after. */}
        {(historyForm && !backfill) || backfillActive ? (
          <section id="history" className="panel rise grid content-start gap-4 rounded-[18px] p-5" style={{ ["--d" as string]: "440ms" }}>
            <div className="grid gap-1">
              <h2 className="text-[15px] font-medium">{backfillActive ? "Historical search in progress" : "Search the past too"}</h2>
              <p className="max-w-[80ch] text-[12px] text-muted-foreground">
                {backfillActive
                  ? "Collected separately from ongoing monitoring, in resumable steps. Platforms that can't search as far back say so."
                  : "You skipped this when setting up. Run it once to fill in mentions from before monitoring started; ongoing monitoring covers everything after."}
              </p>
            </div>
            {backfill && ["queued", "searching"].includes(backfill.status) && <AutoRefresh everyMs={15_000} />}
            {backfillActive && backfill && (
              <BackfillProgress status={backfill} allowanceRemaining={usage?.mentionsRemaining ?? null} renewsOn={usage ? usage.periodEnd.slice(0, 10) : null} />
            )}
            {!backfill && historyForm && <HistoryForm {...historyForm} />}
          </section>
        ) : null}
      </div>
    </>
  );
}

const KIND_LABEL: Record<string, string> = {
  exact_name: "Product name", domain: "Domain", handle: "Handle", custom: "Phrase", abbreviation: "Abbreviation", misspelling: "Spelling variant",
};

function KeywordCoverageList({ rows }: { rows: KeywordCoverageRow[] }) {
  return (
    <ul className="divide-y divide-foreground/[0.06] overflow-hidden rounded-2xl border border-foreground/[0.08]" aria-label="Keyword coverage">
      {rows.map((k) => {
        const searched = k.platforms.filter((p) => p.intervalMinutes !== null);
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

/** Platforms with mentions, busiest first (the order identity colours are given in). */
function platformOrder(k: KeywordRankings) {
  return k.platforms.filter((p) => (p.mentions ?? 0) > 0).map((p) => p.id);
}

const GREY = "color-mix(in oklab, var(--foreground) 22%, transparent)";

/** Platform share as a donut with a legend (identity colours shared with the keyword bars and table). */
function PlatformDonut({ rows, total, colorOf }: { rows: KeywordRankings["platforms"]; total: number; colorOf: Map<string, string> }) {
  const items = rows.filter((r) => (r.mentions ?? 0) > 0);
  const sum = items.reduce((t, r) => t + (r.mentions ?? 0), 0);
  if (sum === 0) return <p className="grid min-h-40 place-content-center rounded-xl border border-dashed text-[13px] text-muted-foreground">No mentions in this period yet.</p>;
  const r = 62, c = 2 * Math.PI * r, gap = items.length > 1 ? 6 : 0;
  const lens = items.map((it) => ((it.mentions ?? 0) / sum) * c);
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((t, x) => t + x, 0));
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-center gap-6">
      <div className="relative shrink-0" style={{ width: 160, height: 160 }}>
        <svg viewBox="0 0 160 160" className="size-full -rotate-90" aria-hidden>
          {items.map((it, i) => (
            <circle key={it.id} cx="80" cy="80" r={r} fill="none" stroke={colorOf.get(it.id) ?? GREY} strokeWidth="18"
              strokeDasharray={`${Math.max(0.5, lens[i]! - gap)} ${c}`} strokeDashoffset={-starts[i]!} className="fade-in" style={{ ["--d" as string]: `${400 + i * 90}ms` }} />
          ))}
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <CountUp value={total} className="text-[30px] font-semibold leading-none tracking-[-0.04em]" />
          <span className="mt-1 text-[12px] text-muted-foreground/80">mentions</span>
        </div>
      </div>
      {/* Flex, not an arbitrary grid track: the legend always shrinks to the card and long names truncate. */}
      <ul className="grid gap-1.5 text-[13px]" style={{ flex: "1 1 13rem", minWidth: 0 }}>
        {items.slice(0, 7).map((it) => (
          <li key={it.id} className="flex min-w-0 items-center gap-2.5">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: colorOf.get(it.id) ?? GREY }} aria-hidden />
            <span className="min-w-0 flex-1 truncate" title={it.name}>{it.name.replace(/ \/ Stack Exchange$/, "")}</span>
            <span className="shrink-0 whitespace-nowrap tabular-nums text-[12px] text-muted-foreground">{(it.mentions ?? 0).toLocaleString("en-US")} · {it.sharePct ?? 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The next 24 hours as a track per platform: where its next check falls, and how often it runs. */
function ScanTimeline({ rows, now, stopped, at }: { rows: KeywordRankings["platforms"]; now: number; stopped: boolean; at: (d: string) => string }) {
  const H24 = 24 * 3_600_000;
  const list = rows.filter((r) => r.platform.intervalMinutes);
  if (list.length === 0) return <p className="text-[13px] text-muted-foreground">Nothing is scheduled yet.</p>;
  return (
    <div className="grid gap-2.5">
      <div className="grid grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_5.5rem] items-end gap-3 text-[11px] text-muted-foreground/80" aria-hidden>
        <span />
        <div className="flex justify-between"><span>Now</span><span>+6 h</span><span>+12 h</span><span>+18 h</span><span>+24 h</span></div>
        <span />
      </div>
      <ul className="grid gap-2" aria-label="Scan schedule">
        {list.map((r, i) => {
          const next = r.platform.nextScanAt ? new Date(r.platform.nextScanAt).getTime() : null;
          const offset = next === null ? null : Math.max(0, next - now);
          const pos = offset === null ? null : Math.min(1, offset / H24);
          const beyond = offset !== null && offset > H24;
          const every = r.platform.intervalMinutes! * 60_000;
          // Later checks inside the window (the interval repeats after the next one).
          const repeats: number[] = [];
          if (!stopped && offset !== null) for (let t = offset + every; t < H24 && repeats.length < 48; t += every) repeats.push(t / H24);
          return (
            <li key={r.id} className="grid grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_5.5rem] items-center gap-3 text-[13px]">
              <span className="truncate">{r.name}</span>
              <div className="relative h-7 rounded-full bg-foreground/[0.04]">
                <span className="absolute inset-y-[13px] left-2 right-2 rounded-full bg-foreground/[0.08]" aria-hidden />
                {!stopped && repeats.map((x, j) => (
                  <span key={j} className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/35" style={{ left: `calc(8px + (100% - 16px) * ${x})` }} aria-hidden />
                ))}
                {!stopped && pos !== null && (
                  <span className="rise absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center" style={{ left: `calc(8px + (100% - 16px) * ${pos})`, ["--d" as string]: `${300 + i * 60}ms` }}
                    title={r.platform.nextScanAt ? `Next check ${at(r.platform.nextScanAt)}` : undefined}>
                    <span className={`size-3.5 rounded-full border-2 border-surface ${beyond ? "bg-foreground/40" : "bg-foreground"}`} />
                  </span>
                )}
                {stopped && <span className="absolute inset-0 grid place-content-center text-[11px] text-muted-foreground">Stopped</span>}
              </div>
              <span className="text-right text-[12px] tabular-nums text-muted-foreground">every {formatInterval(r.platform.intervalMinutes!)}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-muted-foreground/80">Large dot: next check · small dots: later checks at the current interval. Intervals adapt as activity changes.</p>
    </div>
  );
}

function Stat({ label, value, hint, i = 0, warn = false, className = "" }: { label: string; value: React.ReactNode; hint?: string; i?: number; warn?: boolean; className?: string }) {
  return (
    <div className={`panel rise grid min-w-0 content-start gap-1.5 rounded-[18px] p-4 ${className}`} style={{ ["--d" as string]: `${160 + i * 50}ms` }}>
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className={`text-[24px] font-semibold leading-none tracking-[-0.03em] tabular ${warn ? "text-warning" : ""}`}>{value}</span>
      {hint && <span className="truncate text-[12px] text-muted-foreground/80">{hint}</span>}
    </div>
  );
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
function ShareBar({ pct, color }: { pct: number | null; color?: string }) {
  return (
    <span className="block h-2 w-full overflow-hidden rounded-full bg-foreground/[0.07]" aria-hidden>
      <span className="grow-x block h-2 rounded-full" style={{ width: `${pct ?? 0}%`, background: color ?? "color-mix(in oklab, var(--foreground) 75%, transparent)" }} />
    </span>
  );
}

function KeywordList({ rows, colorOf }: { rows: KeywordPerformance[]; colorOf: Map<string, string> }) {
  return (
    <ul className="divide-y divide-foreground/[0.06] overflow-hidden rounded-2xl border border-foreground/[0.08]" aria-label="Keyword performance">
      {rows.map((kw) => {
        const scanned = kw.platforms.filter((p) => p.mentions !== null && p.mentions > 0);
        const distribution = scanned.slice(0, 3).map((p) => `${p.name} ${p.sharePct}%`).join(" · ") + (scanned.length > 3 ? ` · +${scanned.length - 3} more` : "");
        return (
          <li key={kw.term}>
            <details className="group">
              <summary className="grid cursor-pointer grid-cols-[1.5rem_1fr_auto] items-center gap-x-3 gap-y-0.5 px-4 py-3 text-[13px] transition-colors hover:bg-foreground/[0.03] [&::-webkit-details-marker]:hidden sm:grid-cols-[1.5rem_minmax(8rem,1fr)_6rem_minmax(8rem,1fr)_4rem_1rem]">
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
                {!kw.paused && scanned.length > 0 && (
                  <span className="col-span-full mt-1.5 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
                    {scanned.map((p) => <span key={p.id} className="grow-x h-full rounded-full" style={{ flex: Math.max(p.sharePct ?? 0, 1), background: colorOf.get(p.id) ?? GREY }} />)}
                  </span>
                )}
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
                      <ShareBar pct={p.sharePct} color={colorOf.get(p.id)} />
                      <span className="flex items-center justify-end gap-2 tabular">
                        {p.mentions === null ? <span className="text-muted-foreground">Not scanned yet</span> : p.mentions.toLocaleString("en-US")}
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

function PlatformTable({ rows, now, stopped, at, colorOf }: { rows: KeywordRankings["platforms"]; now: number; stopped: boolean; at: (d: string) => string; colorOf: Map<string, string> }) {
  const next = (p: KeywordRankings["platforms"][number]["platform"]) =>
    stopped ? "Stopped" : !p.nextScanAt ? "—" : new Date(p.nextScanAt).getTime() <= now ? "Due now" : formatRelative(new Date(p.nextScanAt), new Date(now));
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
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-foreground/[0.06] transition-colors hover:bg-foreground/[0.025]">
              <td className="py-2 tabular text-muted-foreground">{r.rank ?? "–"}</td>
              <td className="font-medium"><span className="flex items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{ background: colorOf.get(r.id) ?? GREY }} aria-hidden />{r.name}</span></td>
              <td className="text-right tabular">{r.mentions === null ? "—" : r.mentions.toLocaleString("en-US")}</td>
              <td className="pl-4"><span className="flex items-center gap-2"><ShareBar pct={r.sharePct} color={colorOf.get(r.id)} /><span className="w-9 shrink-0 text-right text-xs tabular text-muted-foreground">{r.sharePct === null ? "" : `${r.sharePct}%`}</span></span></td>
              <td className="text-right"><Growth pct={r.growthPct} /></td>
              <td className="pl-4 tabular">{r.platform.intervalMinutes ? `every ${formatInterval(r.platform.intervalMinutes)}` : "—"}</td>
              <td className="tabular" title={r.platform.nextScanAt ? at(r.platform.nextScanAt) : undefined}>{next(r.platform)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="grid gap-2 md:hidden" aria-label="Overall platform performance">
        {rows.map((r) => (
          <li key={r.id} className="grid gap-1.5 rounded-2xl border border-foreground/[0.08] p-3.5 text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium"><span className="mr-1.5 tabular text-muted-foreground">{r.rank ?? "–"}</span>{r.name}</span>
            </div>
            <div className="flex items-center gap-2"><ShareBar pct={r.sharePct} color={colorOf.get(r.id)} /><span className="shrink-0 tabular">{r.mentions === null ? "—" : r.mentions.toLocaleString("en-US")}{r.sharePct !== null && ` · ${r.sharePct}%`}</span></div>
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
