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
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { SpikeGraph, type GraphPoint, type GraphSpike } from "./spike-graph";
import type { InvestigationView } from "@/components/ai/investigation-result";
import { spikeSubject } from "@/lib/server/ai/investigate";
import { hasRole } from "@/lib/server/session";

export const metadata: Metadata = { title: "Buzz Analytics" };

type SearchParams = Record<string, string | undefined>;
const nameOf = (id: string) => integrationInfo(id as never)?.name.replace(/ \/ Stack Exchange$/, "") ?? id;

export default async function BuzzPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const tz = await getTimeZone();
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  if (!product) {
    return (
      <>
        <PageHeader title="Buzz Analytics" />
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
    throw new Error("Buzz Analytics couldn't be loaded. Try again in a moment.");
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

  return (
    <>
      <PageHeader
        title="Buzz Analytics"
        description={<>How much attention {product.name} gets, where, and whether it&apos;s rising · {range.label} · days in {tz}</>}
      />
      <CoverageNotice />

      {nothingMonitored ? (
        <EmptyState icon={Waves} title="No monitoring data in this period" action={{ href: "/monitoring", label: "Open Smart Monitoring" }}>
          Nothing was monitored for {product.name} in this date range{source ? ` on ${nameOf(source)}` : ""}, so there is nothing to count yet.
          Periods without monitoring are shown as gaps, never as zero mentions.
        </EmptyState>
      ) : (
        <div className="grid gap-6">
          <section aria-labelledby="kpis" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <h2 id="kpis" className="sr-only">Key numbers</h2>
            <Kpi label="Mentions today" value={formatCount(d.today)} hint={`Yesterday: ${formatCount(d.yesterday)}`} />
            <Kpi label="Last 24 h vs previous 24 h" value={formatCount(d.daily.current)} growth={d.daily} />
            <Kpi label="Last 7 days vs previous 7" value={formatCount(d.weekly.current)} growth={d.weekly} />
            <Kpi label="Last 30 days vs previous 30" value={formatCount(d.monthly.current)} growth={d.monthly} />
            <Kpi label={`Mentions · ${range.label.toLowerCase()}`} value={formatCount(t.relevant)} growth={d.rangeGrowth}
              hint={t.duplicatesExcluded ? `${t.duplicatesExcluded} duplicate/repost${t.duplicatesExcluded === 1 ? "" : "s"} not counted` : undefined} />
            <Kpi label="Unique authors" value={t.withAuthor ? formatCount(t.uniqueAuthors) : "—"}
              hint={t.withAuthor < t.relevant ? `Measurable for ${t.withAuthor} of ${t.relevant} mentions` : "Per-platform identities"} />
            <Kpi label="Engagement" value={formatCount(t.engagement)} hint="Likes, comments, points… as each platform reports them" />
            <Kpi label="Monitoring coverage" value={`${Math.round(d.coverage.range * 100)}%`}
              hint={[
                d.coverage.gaps ? `${d.coverage.gaps} period${d.coverage.gaps === 1 ? "" : "s"} not monitored` : null,
                d.coverage.complete < d.coverage.range - 0.01 ? `${Math.round(d.coverage.complete * 100)}% complete — some checks hit page limits` : null,
              ].filter(Boolean).join(" · ") || "Every period fully monitored"} />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Mentions and spikes</CardTitle>
              <CardDescription>
                Mentions by publication time ({d.bucket === "hour" ? "hourly" : "daily"}, {tz}) with detected spikes marked. Shaded periods weren&apos;t
                (fully) monitored — gaps, not zeros. Click a spike for what made it up.
                {t.undated > 0 && ` ${t.undated} web result${t.undated === 1 ? "" : "s"} without a publication date ${t.undated === 1 ? "is" : "are"} not charted.`}
                {scope.kind === "keyword" && " The numbers above are for all activity; this graph shows only this keyword."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SpikeGraph
                points={points} bucket={d.bucket} tz={tz} spikes={graphSpikes} events={d.events} scope={scope}
                platforms={sources} keywords={keywords}
                range={{ key: range.key, from: range.fromDate, to: range.toDate }}
                insufficient={d.spikeEvaluation?.status === "insufficient_data" ? { baseline: d.spikeEvaluation.baselinePeriods, needed: d.spikeEvaluation.neededPeriods } : null}
                canExplain={canExplain} workspaceId={workspace.id} productId={product.id}
              />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="min-w-0 lg:col-span-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">Virality score <Badge tone="info">Experimental</Badge></CardTitle>
                <CardDescription>{d.virality.note}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {d.virality.score === null ? (
                  <p className="text-[13px] text-muted-foreground">{d.virality.note}</p>
                ) : (
                  <>
                    {d.virality.basis.length < d.sources.length && (
                      <p className="text-xs text-muted-foreground">
                        Based on {d.virality.basis.map(nameOf).join(", ")} — the platforms monitored completely over the last 4 weeks.
                      </p>
                    )}
                    <p className="flex items-baseline gap-2">
                      <span className="text-3xl font-semibold tabular" aria-label={`Virality ${d.virality.score} out of 100`}>{d.virality.score}</span>
                      <span className="text-[13px] text-muted-foreground">/ 100 · {d.virality.confidence} confidence</span>
                    </p>
                    <ul className="grid gap-2" aria-label="Contributing factors">
                      {d.virality.factors.map((f) => (
                        <li key={f.key} className="grid gap-1">
                          <div className="flex justify-between text-xs"><span>{f.label}</span><span className="tabular text-muted-foreground">{Math.round(f.value * 100)}% · weight {Math.round(f.weight * 100)}%</span></div>
                          <div className="h-1.5 rounded bg-muted" aria-hidden><div className="h-1.5 rounded bg-primary" style={{ width: `${Math.round(f.value * 100)}%` }} /></div>
                          <p className="text-xs text-muted-foreground">{f.detail}</p>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Platform distribution</CardTitle>
                <CardDescription>Relevant mentions · {range.label.toLowerCase()}</CardDescription>
              </CardHeader>
              <CardContent>
                <Distribution
                  items={t.bySource.filter((r) => r.relevant > 0).map((r) => ({ label: nameOf(r.source), value: Number(r.relevant) }))}
                  empty="No relevant mentions in this period."
                  label="Mentions by platform"
                />
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Posts vs comments</CardTitle>
                <CardDescription>Comments include replies and quote posts.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <Distribution
                  items={[{ label: "Posts, videos, articles & reviews", value: t.posts }, { label: "Comments & replies", value: t.comments }].filter((x) => x.value > 0)}
                  empty="No relevant mentions in this period."
                  label="Mentions by type"
                />
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-muted-foreground">Relevant</dt><dd className="tabular text-sm">{formatCount(t.relevant)}</dd></div>
                  <div><dt className="text-muted-foreground">Needs review</dt><dd className="tabular text-sm">{formatCount(t.pending)}</dd></div>
                  <div><dt className="text-muted-foreground">Not relevant</dt><dd className="tabular text-sm">{formatCount(t.irrelevant)}</dd></div>
                </dl>
                {totalTyped !== t.relevant && <p className="text-xs text-muted-foreground">Some mentions have no type and aren&apos;t split.</p>}
              </CardContent>
            </Card>
          </div>

          <p className="text-xs text-muted-foreground">
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

function Kpi({ label, value, growth, hint }: { label: string; value: string; growth?: Growth; hint?: string }) {
  const Icon = !growth || growth.change === 0 ? Minus : growth.change === null || growth.change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <Card className="grid min-w-0 gap-0.5 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular">{value}</span>
      {growth && (
        <span className={cn("flex items-center gap-1 text-xs", growth.reliable ? "text-muted-foreground" : "text-warning")}>
          <Icon className="size-3.5" aria-hidden />
          {growth.label}{growth.change !== null && ` (was ${formatCount(growth.previous)})`}
          {!growth.reliable && " · incomplete data"}
        </span>
      )}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </Card>
  );
}

function Distribution({ items, empty, label }: { items: Array<{ label: string; value: number }>; empty: string; label: string }) {
  const total = items.reduce((a, i) => a + i.value, 0);
  if (total === 0) return <p className="text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="grid gap-2" aria-label={label}>
      {[...items].sort((a, b) => b.value - a.value).map((i, n) => (
        <li key={i.label} className="grid gap-1">
          <div className="flex justify-between gap-2 text-xs"><span className="truncate">{i.label}</span><span className="tabular text-muted-foreground">{i.value} · {Math.round((i.value / total) * 100)}%</span></div>
          <div className="h-1.5 rounded bg-muted" aria-hidden><div className="h-1.5 rounded" style={{ width: `${(i.value / total) * 100}%`, background: `var(--chart-${(n % 8) + 1})` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export const dynamic = "force-dynamic";
