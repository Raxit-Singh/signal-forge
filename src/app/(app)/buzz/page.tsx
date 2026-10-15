import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus, PackagePlus, Waves } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, requireWorkspace } from "@/lib/server/session";
import { getBuzzDashboard } from "@/lib/server/analytics/buzz";
import { isValidTimeZone, type Growth } from "@/lib/analytics/buzz";
import { parseRange } from "@/lib/domain/date-range";
import { integrationInfo } from "@/lib/domain/integrations";
import { isPublicSource } from "@/lib/sources/registry";
import { formatCount, formatUtc } from "@/lib/format";
import { CoverageNotice, EmptyState, PageHeader } from "@/components/page";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { BuzzChart, PlatformFilter, TimeZoneSync } from "./buzz-client";

export const metadata: Metadata = { title: "Buzz Analytics" };

type SearchParams = Record<string, string | undefined>;
const nameOf = (id: string) => integrationInfo(id as never)?.name.replace(/ \/ Stack Exchange$/, "") ?? id;

export default async function BuzzPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
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
  const cookieTz = (await cookies()).get("sf_tz")?.value;
  const tz = cookieTz && isValidTimeZone(cookieTz) ? cookieTz : "UTC";
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

  const sources = d.sources.map((id) => ({ id, name: nameOf(id) }));
  const nothingMonitored = d.sources.length === 0;
  const t = d.totals;
  const totalTyped = t.posts + t.comments;

  return (
    <>
      <TimeZoneSync current={tz} />
      <PageHeader
        title="Buzz Analytics"
        description={<>How much attention {product.name} gets, where, and whether it&apos;s rising · {range.label} · days in {tz}</>}
        actions={<PlatformFilter sources={sources} />}
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
              <CardTitle>Mentions over time</CardTitle>
              <CardDescription>
                By publication time ({d.bucket === "hour" ? "hourly" : "daily"}, {tz}). Grey periods weren&apos;t monitored — they are gaps, not zeros.
                {t.undated > 0 && ` ${t.undated} web result${t.undated === 1 ? "" : "s"} without a publication date ${t.undated === 1 ? "is" : "are"} not charted.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BuzzChart points={d.series} sources={sources} bucket={d.bucket} tz={tz} events={d.events} spikes={d.spikes} />
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

          <Card>
            <CardHeader>
              <CardTitle>Spike history</CardTitle>
              <CardDescription>
                Periods with clearly more mentions than usual, judged against your own rolling baseline. Small numbers (like 1 → 3) never count as a spike.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {d.spikes.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">No spikes detected in this period.</p>
              ) : (
                <ul className="divide-y" aria-label="Detected spikes">
                  {d.spikes.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                      <Badge tone={s.severity === "major" ? "negative" : "warning"}>{s.severity === "major" ? "Major" : "Notable"}</Badge>
                      <span title={formatUtc(s.period_start)}>{s.granularity === "hour" ? "Hour of" : "Day of"} {formatUtc(s.period_start)}</span>
                      <span className="text-muted-foreground">{s.platform ? nameOf(s.platform) : "All platforms"}</span>
                      <span className="ml-auto tabular">{s.observed} mentions vs ~{Number(s.expected).toFixed(Number(s.expected) < 10 ? 1 : 0)} usual</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

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
