import { getTimeZone } from "@/lib/server/timezone";
import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus, PackagePlus, Waves } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, requireWorkspace } from "@/lib/server/session";
import { getBuzzDashboard } from "@/lib/server/analytics/buzz";
import type { Growth } from "@/lib/analytics/buzz";
import { parseRange } from "@/lib/domain/date-range";
import { integrationInfo } from "@/lib/domain/integrations";
import { isPublicSource } from "@/lib/sources/registry";
import { formatCount } from "@/lib/format";
import { CoverageNotice, EmptyState, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/primitives";
import { CountUp } from "@/components/motion";
import { cn } from "@/lib/utils";
import { SpikeGraph, type GraphPoint, type GraphSpike } from "./spike-graph";
import type { InvestigationView } from "@/components/ai/investigation-result";
import { spikeSubject } from "@/lib/server/ai/investigate";
import { hasRole } from "@/lib/server/session";

export const metadata: Metadata = { title: "Trends" };

type SearchParams = Record<string, string | undefined>;
const nameOf = (id: string) => integrationInfo(id as never)?.name.replace(/ \/ Stack Exchange$/, "") ?? id;

export default async function BuzzPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const tz = await getTimeZone();
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  if (!product) {
    return (
      <>
        <PageHeader title="Trends" />
        <EmptyState icon={PackagePlus} title="Add a product first" action={{ href: "/onboarding/product", label: "Add product" }}>
          Buzz is measured per product.
        </EmptyState>
      </>
    );
  }

  const sp = await searchParams;
  const range = parseRange(sp, new Date());
  const source = sp.source && isPublicSource(sp.source) ? sp.source : null;

  const supabase = await createClient();
  let d: Awaited<ReturnType<typeof getBuzzDashboard>>;
  try {
    d = await getBuzzDashboard(supabase, product.id, range, tz, source ? [source] : null);
  } catch (e) {
    console.error(`[buzz] ${e instanceof Error ? e.message : e}`);
    throw new Error("Trends couldn't be loaded. Try again in a moment.");
  }

  const { data: invs } = await supabase.from("ai_investigations").select("subject_key, status, report, error, model, completed_at")
    .eq("product_id", product.id).eq("kind", "spike_explanation");
  const explanations = new Map((invs ?? []).map((i) => [i.subject_key as string, i as unknown as InvestigationView]));
  const canExplain = hasRole(workspace.role, "member");

  const sources = d.sources.map((id) => ({ id, name: nameOf(id) }));

  // One graph: the selected scope (all activity, one platform or one keyword) over the selected range.
  const { data: aliasRows } = await supabase.from("product_aliases").select("term").eq("product_id", product.id).eq("enabled", true).order("term");
  const keywords = [...new Set((aliasRows ?? []).map((a) => a.term as string))];
  const keyword = sp.keyword ? keywords.find((k) => k.toLowerCase() === sp.keyword!.toLowerCase()) ?? null : null;
  let points: GraphPoint[] = d.series.map((x) => ({ start: x.start, value: x.relevant, coverage: x.coverage }));
  if (keyword && d.series.length) {
    const { data: kw } = await supabase.rpc("keyword_series", {
      p_product_id: product.id, p_from: d.series[0]!.start, p_to: range.to.toISOString(), p_bucket: d.bucket, p_tz: tz,
    });
    const counts = new Map(((kw ?? []) as Array<{ bucket_start: string; keyword: string; relevant: number }>)
      .filter((r) => r.keyword === keyword.toLowerCase()).map((r) => [new Date(r.bucket_start).getTime(), Number(r.relevant)]));
    points = d.series.map((x) => ({ start: x.start, coverage: x.coverage, value: x.coverage === "none" ? null : counts.get(new Date(x.start).getTime()) ?? 0 }));
  }
  const scope = keyword ? { kind: "keyword" as const, value: keyword, label: `“${keyword}”` }
    : source ? { kind: "platform" as const, value: source, label: nameOf(source) } : { kind: "all" as const, value: null, label: "all activity" };
  const graphFrom = d.series.length ? new Date(d.series[0]!.start).getTime() : range.from.getTime();
  // A "possible" spike needs a baseline: with no fully monitored days before it, the first days of
  // monitoring would always look like a jump from nothing. Those aren't shown.
  const noBaseline = d.spikeEvaluation?.status === "insufficient_data" && (d.spikeEvaluation.baselinePeriods ?? 0) === 0;
  const graphSpikes: GraphSpike[] = d.spikes
    .filter((x) => {
      const t = new Date(x.period_start).getTime();
      if (t < graphFrom || t >= range.to.getTime()) return false;
      if (noBaseline && x.confidence === "possible") return false;
      if (scope.kind === "keyword") return (x.keyword ?? "").toLowerCase() === keyword!.toLowerCase();
      if (x.keyword) return false;
      return scope.kind === "platform" ? x.platform === source : !x.platform;
    })
    .map((x) => {
      const key = spikeSubject({ granularity: x.granularity as "hour" | "day", platform: x.keyword ? null : x.platform, periodStart: x.period_start, keyword: x.keyword ?? null });
      return {
        id: x.id, start: x.period_start, end: x.period_end, granularity: x.granularity as "hour" | "day",
        observed: Number(x.observed), expected: Number(x.expected), ratio: x.ratio === null ? null : Number(x.ratio),
        confidence: x.confidence, severity: x.severity, note: x.note, platform: x.keyword ? null : x.platform, keyword: x.keyword ?? null,
        scopeLabel: x.keyword ? `Keyword “${x.keyword}”` : x.platform ? nameOf(x.platform) : "All platforms",
        explanation: explanations.get(key) ?? null,
      };
    });
  const nothingMonitored = d.sources.length === 0;
  const t = d.totals;
  const totalTyped = t.posts + t.comments;

  const growthPct = (g: Growth) => (g.change === null ? null : Math.round(g.change * 1000) / 10);
  const momentum = [
    { label: "Today", value: d.today, hint: `Yesterday: ${formatCount(d.yesterday)}`, growth: null as Growth | null },
    { label: "Last 24 h vs previous 24 h", value: d.daily.current, growth: d.daily },
    { label: "Last 7 days vs previous 7", value: d.weekly.current, growth: d.weekly },
    { label: "Last 30 days vs previous 30", value: d.monthly.current, growth: d.monthly },
  ];
  const coverage = Math.round(d.coverage.range * 100);

  return (
    <>
      <CoverageNotice />

      {nothingMonitored ? (
        <>
          <PageHeader title="Trends" description={<>How much attention {product.name} gets, where, and whether it&apos;s rising</>} />
          <EmptyState icon={Waves} title="No monitoring data in this period" action={{ href: "/monitoring", label: "Open Smart Monitoring" }}>
            Nothing was monitored for {product.name} in this date range{source ? ` on ${nameOf(source)}` : ""}, so there is nothing to count yet.
            Periods without monitoring are shown as gaps, never as zero mentions.
          </EmptyState>
        </>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 pb-10">
          {/* Hero: the period's volume and whether it's rising, at three speeds. */}
          <section className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="rise grid content-start gap-5">
              <div className="grid gap-1.5">
                <h1 className="text-[34px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]">Trends</h1>
                <p className="max-w-[60ch] text-[14px] text-muted-foreground">How much attention {product.name} gets, where, and whether it&apos;s rising · {range.label.toLowerCase()} · days in {tz}</p>
              </div>
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <CountUp value={t.relevant} className="text-[56px] font-semibold leading-none tracking-[-0.045em] sm:text-[64px]" />
                  {growthPct(d.rangeGrowth) !== null && (
                    <span className={cn("panel flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] tabular-nums",
                      d.rangeGrowth.change! >= 0 ? "text-positive" : "text-signal")}>
                      {d.rangeGrowth.change! >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
                      {d.rangeGrowth.change! >= 0 ? "+" : "−"}{Math.abs(growthPct(d.rangeGrowth)!)}%
                      <span className="sr-only"> vs the previous period</span>
                    </span>
                  )}
                </div>
                <p className="text-[14px] text-muted-foreground">
                  mentions {scope.kind === "all" ? "" : `(${nameOf(source ?? "")}) `}{range.label.toLowerCase()} · {formatCount(t.uniqueAuthors)} people · {formatCount(t.engagement)} engagement
                </p>
              </div>
            </div>
            <div className="rise grid grid-cols-2 gap-3 self-end" style={{ ["--d" as string]: "120ms" }}>
              {momentum.map((m, i) => <Momentum key={m.label} i={i} {...m} />)}
            </div>
          </section>

          <section aria-labelledby="kpis" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <h2 id="kpis" className="sr-only">Key numbers</h2>
            <Kpi i={0} label={`Mentions · ${range.label.toLowerCase()}`} value={t.relevant} growth={d.rangeGrowth}
              hint={t.duplicatesExcluded ? `${t.duplicatesExcluded} duplicate/repost${t.duplicatesExcluded === 1 ? "" : "s"} not counted` : "No duplicates or reposts in this period"} />
            <Kpi i={1} label="Unique authors" value={t.withAuthor ? t.uniqueAuthors : null}
              hint={t.withAuthor < t.relevant ? `Measurable for ${t.withAuthor} of ${t.relevant} mentions` : "Per-platform identities"} />
            <Kpi i={2} label="Engagement" value={t.engagement} hint="Likes, comments, points… as each platform reports them" />
            <div className="panel rise flex items-center gap-4 rounded-[18px] p-4" style={{ ["--d" as string]: "330ms" }}>
              <Ring value={d.coverage.range} />
              <div className="grid min-w-0 gap-1">
                <span className="text-[13px] text-muted-foreground">Monitoring coverage</span>
                <span className="text-[24px] font-semibold leading-none tracking-[-0.03em] tabular">{coverage}%</span>
                <span className="text-[12px] text-muted-foreground/80">
                  {[
                    d.coverage.gaps ? `${d.coverage.gaps} period${d.coverage.gaps === 1 ? "" : "s"} not monitored` : null,
                    d.coverage.complete < d.coverage.range - 0.01 ? `${Math.round(d.coverage.complete * 100)}% complete — some checks hit page limits` : null,
                  ].filter(Boolean).join(" · ") || "Every period fully monitored"}
                </span>
              </div>
            </div>
          </section>

          <section className="panel rise grid gap-4 rounded-[18px] p-5 sm:p-6" style={{ ["--d" as string]: "380ms" }}>
            <div className="grid gap-1">
              <h2 className="text-[20px] font-medium tracking-[-0.02em]">Mentions and spikes</h2>
              <p className="max-w-[90ch] text-[12px] text-muted-foreground">
                Mentions by publication time ({d.bucket === "hour" ? "hourly" : "daily"}, {tz}) with detected spikes marked. Shaded periods weren&apos;t
                (fully) monitored — gaps, not zeros. Click a spike for what made it up.
                {t.undated > 0 && ` ${t.undated} web result${t.undated === 1 ? "" : "s"} without a publication date ${t.undated === 1 ? "is" : "are"} not charted.`}
                {scope.kind === "keyword" && " The numbers above are for all activity; this graph shows only this keyword."}
              </p>
            </div>
            <SpikeGraph
              points={points} bucket={d.bucket} tz={tz} spikes={graphSpikes} events={d.events} scope={scope}
              platforms={sources} keywords={keywords}
              range={{ key: range.key, from: range.fromDate, to: range.toDate }}
              insufficient={d.spikeEvaluation?.status === "insufficient_data" ? { baseline: d.spikeEvaluation.baselinePeriods, needed: d.spikeEvaluation.neededPeriods } : null}
              canExplain={canExplain} workspaceId={workspace.id} productId={product.id}
            />
          </section>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
            <section className="panel rise grid content-start gap-4 rounded-[18px] p-5" style={{ ["--d" as string]: "440ms" }}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[13px] text-muted-foreground">Virality score</h2>
                <Badge tone="info">Experimental</Badge>
              </div>
              {d.virality.score === null ? (
                <p className="grid min-h-40 place-content-center rounded-xl border border-dashed px-4 text-center text-[13px] text-muted-foreground">{d.virality.note}</p>
              ) : (
                <>
                  <Gauge score={d.virality.score} confidence={d.virality.confidence} />
                  {d.virality.basis.length < d.sources.length && (
                    <p className="text-[12px] text-muted-foreground">Based on {d.virality.basis.map(nameOf).join(", ")} — the platforms monitored completely over the last 4 weeks.</p>
                  )}
                  <ul className="grid gap-3" aria-label="Contributing factors">
                    {d.virality.factors.map((f, i) => (
                      <li key={f.key} className="grid gap-1.5">
                        <div className="flex justify-between gap-2 text-[13px]"><span>{f.label}</span><span className="tabular text-[12px] text-muted-foreground">{Math.round(f.value * 100)}% · weight {Math.round(f.weight * 100)}%</span></div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]" aria-hidden>
                          <div className="grow-x h-full rounded-full bg-foreground/70" style={{ width: `${Math.round(f.value * 100)}%`, ["--d" as string]: `${600 + i * 60}ms` }} />
                        </div>
                        <p className="text-[12px] text-muted-foreground/80">{f.detail}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[12px] text-muted-foreground/80">{d.virality.note}</p>
                </>
              )}
            </section>

            <section className="panel rise grid content-start gap-4 rounded-[18px] p-5" style={{ ["--d" as string]: "500ms" }}>
              <div className="grid gap-1">
                <h2 className="text-[13px] text-muted-foreground">Platform distribution</h2>
                <p className="text-[12px] text-muted-foreground/80">Relevant mentions · {range.label.toLowerCase()}</p>
              </div>
              <Distribution
                items={t.bySource.filter((r) => r.relevant > 0).map((r) => ({ label: nameOf(r.source), value: Number(r.relevant) }))}
                empty="No relevant mentions in this period." label="Mentions by platform" highlightTop
              />
            </section>

            <section className="panel rise grid content-start gap-4 rounded-[18px] p-5 md:col-span-2 xl:col-span-1" style={{ ["--d" as string]: "560ms" }}>
              <div className="grid gap-1">
                <h2 className="text-[13px] text-muted-foreground">Posts vs comments</h2>
                <p className="text-[12px] text-muted-foreground/80">Comments include replies and quote posts.</p>
              </div>
              {totalTyped > 0 && (
                <div className="flex h-14 gap-1.5" aria-hidden>
                  <div className="grow-x grid place-content-center rounded-xl bg-foreground text-[13px] font-semibold text-background" style={{ flex: Math.max(t.posts, 0.0001), ["--d" as string]: "650ms" }}>
                    {t.posts > 0 && `${Math.round((t.posts / totalTyped) * 100)}%`}
                  </div>
                  <div className="grow-x grid place-content-center rounded-xl text-[13px] font-semibold" style={{ flex: Math.max(t.comments, 0.0001), ["--d" as string]: "720ms",
                    background: "repeating-linear-gradient(90deg, color-mix(in oklab, var(--foreground) 55%, transparent) 0 4px, transparent 4px 9px)" }}>
                    {t.comments > 0 && <span className="rounded-full bg-background/80 px-1.5">{Math.round((t.comments / totalTyped) * 100)}%</span>}
                  </div>
                </div>
              )}
              <Distribution
                items={[{ label: "Posts, videos, articles & reviews", value: t.posts }, { label: "Comments & replies", value: t.comments }].filter((x) => x.value > 0)}
                empty="No relevant mentions in this period." label="Mentions by type"
              />
              <dl className="grid grid-cols-3 gap-2 border-t border-foreground/[0.06] pt-3 text-[12px]">
                <div><dt className="text-muted-foreground">Relevant</dt><dd className="tabular text-[16px] font-semibold">{formatCount(t.relevant)}</dd></div>
                <div><dt className="text-muted-foreground">Needs review</dt><dd className="tabular text-[16px] font-semibold">{formatCount(t.pending)}</dd></div>
                <div><dt className="text-muted-foreground">Not relevant</dt><dd className="tabular text-[16px] font-semibold">{formatCount(t.irrelevant)}</dd></div>
              </dl>
              {totalTyped !== t.relevant && <p className="text-[12px] text-muted-foreground">Some mentions have no type and aren&apos;t split.</p>}
            </section>
          </div>

          <p className="px-1 text-[12px] text-muted-foreground/80">
            Counts come only from mentions SignalForge stored: duplicates and reposts are excluded, publication time is used (not discovery time),
            and late-arriving mentions update past periods. Monitoring freshness per platform is on{" "}
            <Link href="/monitoring" className="underline underline-offset-2">Smart Monitoring</Link>.
            {d.daily.reliable && d.weekly.reliable ? null : (
              <span className="mt-1 flex items-start gap-1 text-warning">
                <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                Some growth figures compare periods that weren&apos;t fully monitored; treat them as approximate.
              </span>
            )}
          </p>
        </div>
      )}
    </>
  );
}

function GrowthLine({ growth }: { growth: Growth }) {
  const Icon = growth.change === 0 ? Minus : growth.change === null || growth.change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("flex items-center gap-1 text-[12px]", !growth.reliable ? "text-warning" : growth.change !== null && growth.change < 0 ? "text-signal" : growth.change ? "text-positive" : "text-muted-foreground")}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{growth.label}{growth.change !== null && ` (was ${formatCount(growth.previous)})`}{!growth.reliable && " · incomplete data"}</span>
    </span>
  );
}

function Momentum({ i, label, value, growth, hint }: { i: number; label: string; value: number; growth: Growth | null; hint?: string }) {
  return (
    <div className="panel rise grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-[18px] p-4" style={{ ["--d" as string]: `${160 + i * 60}ms` }}>
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <CountUp value={value} className="text-[26px] font-semibold leading-none tracking-[-0.03em]" />
      {growth ? <GrowthLine growth={growth} /> : <span className="text-[12px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function Kpi({ i, label, value, growth, hint }: { i: number; label: string; value: number | null; growth?: Growth; hint?: string }) {
  return (
    <div className="panel rise grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2 rounded-[18px] p-4" style={{ ["--d" as string]: `${240 + i * 45}ms` }}>
      <span className="text-[13px] text-muted-foreground">{label}</span>
      {value === null ? <span className="text-[24px] font-semibold leading-none">—</span>
        : <CountUp value={value} className="text-[24px] font-semibold leading-none tracking-[-0.03em]" />}
      {growth && <GrowthLine growth={growth} />}
      {hint && <span className="text-[12px] text-muted-foreground/80">{hint}</span>}
    </div>
  );
}

/** Monitoring coverage as a ring (red when under half the period was monitored). */
function Ring({ value }: { value: number }) {
  const c = 2 * Math.PI * 22;
  const low = value < 0.5;
  return (
    <svg viewBox="0 0 56 56" className="size-14 shrink-0 -rotate-90" aria-hidden>
      <circle cx="28" cy="28" r="22" fill="none" stroke="color-mix(in oklab, var(--foreground) 8%, transparent)" strokeWidth="6" />
      <circle cx="28" cy="28" r="22" fill="none" stroke={low ? "var(--signal)" : "var(--foreground)"} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${Math.max(0.01, value) * c} ${c}`} className="ring-fill" style={{ ["--len" as string]: c, ["--d" as string]: "500ms" }} />
    </svg>
  );
}

/** Virality as a half gauge, 0–100; the needle zone turns red from 70. */
function Gauge({ score, confidence }: { score: number; confidence: string }) {
  const r = 70, len = Math.PI * r;
  const hot = score >= 70;
  return (
    <div className="relative mx-auto w-full max-w-[240px]">
      <svg viewBox="0 0 180 100" className="w-full" aria-hidden>
        <path d="M20 90 A70 70 0 0 1 160 90" fill="none" stroke="color-mix(in oklab, var(--foreground) 8%, transparent)" strokeWidth="14" strokeLinecap="round" />
        <path d="M20 90 A70 70 0 0 1 160 90" fill="none" stroke={hot ? "var(--signal)" : "var(--foreground)"} strokeWidth="14" strokeLinecap="round"
          strokeDasharray={`${(score / 100) * len} ${len}`} className="ring-fill" style={{ ["--len" as string]: len, ["--d" as string]: "600ms",
            filter: hot ? "drop-shadow(0 0 8px color-mix(in oklab, var(--signal) 60%, transparent))" : undefined }} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 grid justify-items-center">
        <span className="text-[36px] font-semibold leading-none tracking-[-0.04em] tabular" aria-label={`Virality ${score} out of 100`}>{score}</span>
        <span className="text-[12px] text-muted-foreground">/ 100 · {confidence} confidence</span>
      </div>
    </div>
  );
}

function Distribution({ items, empty, label, highlightTop = false }: { items: Array<{ label: string; value: number }>; empty: string; label: string; highlightTop?: boolean }) {
  const total = items.reduce((a, i) => a + i.value, 0);
  if (total === 0) return <p className="text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="grid gap-3" aria-label={label}>
      {[...items].sort((a, b) => b.value - a.value).map((i, n) => (
        <li key={i.label} className="grid gap-1.5">
          <div className="flex justify-between gap-2 text-[13px]"><span className="truncate">{i.label}</span><span className="tabular text-[12px] text-muted-foreground">{i.value} · {Math.round((i.value / total) * 100)}%</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]" aria-hidden>
            <div className="grow-x h-full rounded-full" style={{ width: `${(i.value / total) * 100}%`, ["--d" as string]: `${550 + n * 50}ms`,
              background: highlightTop && n === 0 ? "var(--foreground)" : "color-mix(in oklab, var(--foreground) 45%, transparent)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export const dynamic = "force-dynamic";
