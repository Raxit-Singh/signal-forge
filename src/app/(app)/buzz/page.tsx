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
import { TrendGraph, type GraphPoint } from "./trend-graph";
import { getCoverageSummary } from "@/lib/server/collection/status";

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

  // The platform choices come from what's monitored for the product, not from the filtered view
  // (otherwise picking a platform would leave only that platform to choose from).
  const coverageSummary = await getCoverageSummary(product.id);
  const sources = coverageSummary.included.map((x) => ({ id: x.id as string, name: nameOf(x.id) })).sort((a, b) => a.name.localeCompare(b.name));

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
  const nothingMonitored = d.sources.length === 0;
  const t = d.totals;
  const totalTyped = t.posts + t.comments;

  const momentum = [
    { label: "Today", value: d.today, hint: `Yesterday: ${formatCount(d.yesterday)}`, growth: null as Growth | null },
    { label: "Last 24 h vs previous 24 h", value: d.daily.current, growth: d.daily },
    { label: "Last 7 days vs previous 7", value: d.weekly.current, growth: d.weekly },
  ];
  const coverage = Math.round(d.coverage.range * 100);
  const growthPct = d.rangeGrowth.change === null ? null : Math.round(d.rangeGrowth.change * 1000) / 10;
  const platformItems = t.bySource.filter((r) => r.relevant > 0).map((r) => ({ id: r.source, label: nameOf(r.source), value: Number(r.relevant) })).sort((a, b) => b.value - a.value);

  return (
    <>
      <CoverageNotice />

      {nothingMonitored ? (
        <>
          <PageHeader title="Trends" description={<>How much attention {product.name} gets and whether it&apos;s rising</>} />
          <EmptyState icon={Waves} title="No monitoring data in this period" action={{ href: "/monitoring", label: "Open Smart Monitoring" }}>
            Nothing was monitored for {product.name} in this date range{source ? ` on ${nameOf(source)}` : ""}, so there is nothing to count yet.
            Periods without monitoring are shown as gaps, never as zero mentions.
          </EmptyState>
        </>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 pb-10">
          {/* Hero: the period's total once, with momentum at three speeds and how complete the data is. */}
          <section className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="rise grid content-start gap-5">
              <div className="grid gap-1.5">
                <h1 className="text-[34px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]">Trends</h1>
                <p className="text-[14px] text-muted-foreground">How much attention {product.name} gets and whether it&apos;s rising{source ? ` on ${nameOf(source)}` : ""}</p>
              </div>
              <div className="grid gap-2">
                <span className="text-[13px] text-muted-foreground">{`Mentions · ${range.label.toLowerCase()}`}</span>
                <div className="flex flex-wrap items-center gap-3">
                  <CountUp value={t.relevant} className="text-[56px] font-semibold leading-none tracking-[-0.045em] sm:text-[64px]" />
                  {growthPct !== null && (
                    <span className={cn("panel flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] tabular-nums", growthPct >= 0 ? "text-positive" : "text-signal")}>
                      {growthPct >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
                      {growthPct >= 0 ? "+" : "−"}{Math.abs(growthPct)}%<span className="sr-only"> vs the previous period</span>
                    </span>
                  )}
                </div>
                <span className="text-[12px] text-muted-foreground/80">
                  {t.duplicatesExcluded ? `${t.duplicatesExcluded} duplicate/repost${t.duplicatesExcluded === 1 ? "" : "s"} not counted` : "No duplicates or reposts in this period"}
                </span>
              </div>
              <dl className="flex flex-wrap gap-x-8 gap-y-3 border-t border-foreground/[0.06] pt-4">
                <div className="grid gap-0.5">
                  <dt className="text-[12px] text-muted-foreground">Unique authors</dt>
                  <dd className="text-[22px] font-semibold leading-none tracking-[-0.03em]">{t.withAuthor ? <CountUp value={t.uniqueAuthors} /> : "—"}</dd>
                </div>
                <div className="grid gap-0.5">
                  <dt className="text-[12px] text-muted-foreground">Engagement</dt>
                  <dd className="text-[22px] font-semibold leading-none tracking-[-0.03em]"><CountUp value={t.engagement} format={{ notation: "compact", maximumFractionDigits: 1 }} /></dd>
                </div>
                <div className="grid gap-0.5">
                  <dt className="text-[12px] text-muted-foreground">Needs review</dt>
                  <dd className="text-[22px] font-semibold leading-none tracking-[-0.03em]">{formatCount(t.pending)}</dd>
                </div>
              </dl>
            </div>
            <div className="rise grid grid-cols-2 gap-3 self-end" style={{ ["--d" as string]: "120ms" }}>
              {momentum.map((m, i) => <Momentum key={m.label} i={i} {...m} />)}
              <div className="panel rise flex min-w-0 items-center gap-3 rounded-[18px] p-4" style={{ ["--d" as string]: "340ms" }}>
                <Ring value={d.coverage.range} />
                <div className="grid min-w-0 gap-1">
                  <span className="text-[12px] text-muted-foreground">Monitoring coverage</span>
                  <span className="text-[26px] font-semibold leading-none tracking-[-0.03em] tabular">{coverage}%</span>
                  <span className="truncate text-[12px] text-muted-foreground/80" title={[
                    d.coverage.gaps ? `${d.coverage.gaps} period${d.coverage.gaps === 1 ? "" : "s"} not monitored` : null,
                    d.coverage.complete < d.coverage.range - 0.01 ? `${Math.round(d.coverage.complete * 100)}% complete — some checks hit page limits` : null,
                  ].filter(Boolean).join(" · ") || undefined}>
                    {d.coverage.gaps ? `${d.coverage.gaps} period${d.coverage.gaps === 1 ? "" : "s"} not monitored` : "Every period monitored"}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="panel rise grid gap-4 rounded-[18px] p-5 sm:p-6" style={{ ["--d" as string]: "380ms" }}>
            <div className="grid gap-1">
              <h2 className="text-[20px] font-medium tracking-[-0.02em]">Mentions over time</h2>
              <p className="max-w-[90ch] text-[12px] text-muted-foreground">
                By publication time ({d.bucket === "hour" ? "hourly" : "daily"}, {tz}). Shaded periods weren&apos;t (fully) monitored — gaps, not zeros.
                {t.undated > 0 && ` ${t.undated} web result${t.undated === 1 ? "" : "s"} without a publication date ${t.undated === 1 ? "is" : "are"} not charted.`}
                {scope.kind === "keyword" && " The numbers above are for all activity; this graph shows only this keyword."}
              </p>
            </div>
            <TrendGraph
              points={points} bucket={d.bucket} tz={tz} events={d.events} scope={scope}
              platforms={sources} keywords={keywords}
              range={{ key: range.key, from: range.fromDate, to: range.toDate }}
            />
          </section>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-12">
            <section className="panel rise grid content-start gap-5 rounded-[18px] p-5 md:col-span-2 xl:col-span-6" style={{ ["--d" as string]: "440ms" }}>
              <div className="grid gap-1">
                <h2 className="text-[13px] text-muted-foreground">Where the conversation is</h2>
                <p className="text-[12px] text-muted-foreground/80">Relevant mentions by platform · {range.label.toLowerCase()} · pick one to chart it</p>
              </div>
              <PlatformDonut items={platformItems} total={t.relevant} active={source} hrefFor={(id) => {
                // Same page and range; choosing the active platform again goes back to all platforms.
                const q = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1] && e[0] !== "source" && e[0] !== "keyword"));
                if (id !== source) q.set("source", id);
                return `/buzz${q.size ? `?${q}` : ""}`;
              }} />
            </section>

            <section className="panel rise grid content-start gap-4 rounded-[18px] p-5 xl:col-span-3" style={{ ["--d" as string]: "500ms" }}>
              <div className="grid gap-1">
                <h2 className="text-[13px] text-muted-foreground">Posts vs comments</h2>
                <p className="text-[12px] text-muted-foreground/80">Comments include replies and quote posts.</p>
              </div>
              {totalTyped > 0 && (
                <div className="flex h-24 gap-1.5" aria-hidden>
                  <div className="grow-y grid content-end rounded-2xl bg-gradient-to-b from-foreground/85 to-foreground/55 p-3 text-background" style={{ flex: Math.max(t.posts, 0.0001), ["--d" as string]: "650ms" }}>
                    <span className="text-[20px] font-semibold leading-none">{Math.round((t.posts / totalTyped) * 100)}%</span>
                  </div>
                  {t.comments > 0 && (
                    <div className="grow-y grid content-end rounded-2xl p-3" style={{ flex: Math.max(t.comments, 0.0001), ["--d" as string]: "720ms",
                      background: "repeating-linear-gradient(90deg, color-mix(in oklab, var(--foreground) 35%, transparent) 0 3px, transparent 3px 8px)" }}>
                      <span className="w-fit rounded-full bg-background/85 px-1.5 text-[13px] font-semibold">{Math.round((t.comments / totalTyped) * 100)}%</span>
                    </div>
                  )}
                </div>
              )}
              <Distribution
                items={[{ label: "Posts, videos, articles & reviews", value: t.posts }, { label: "Comments & replies", value: t.comments }].filter((x) => x.value > 0)}
                empty="No relevant mentions in this period." label="Mentions by type"
              />
              {totalTyped !== t.relevant && <p className="text-[12px] text-muted-foreground">Some mentions have no type and aren&apos;t split.</p>}
            </section>

            <section className="panel rise grid content-start gap-4 rounded-[18px] p-5 xl:col-span-3" style={{ ["--d" as string]: "560ms" }}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[13px] text-muted-foreground">Virality score</h2>
                <Badge tone="info">Experimental</Badge>
              </div>
              {d.virality.score === null ? (
                <p className="grid min-h-40 place-content-center rounded-xl border border-dashed px-4 text-center text-[13px] text-muted-foreground">{d.virality.note}</p>
              ) : (
                <>
                  <Gauge score={d.virality.score} confidence={d.virality.confidence} />
                  <ul className="grid gap-2" aria-label="Contributing factors">
                    {d.virality.factors.map((f) => (
                      <li key={f.key} className="grid grid-cols-[minmax(0,1fr)_64px_36px] items-center gap-2 text-[12px]" title={`${f.detail} · weight ${Math.round(f.weight * 100)}%`}>
                        <span className="truncate text-foreground/85">{f.label}</span>
                        <span className="block h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]" aria-hidden>
                          <span className="grow-x block h-full rounded-full bg-foreground/70" style={{ width: `${Math.round(f.value * 100)}%` }} />
                        </span>
                        <span className="text-right tabular-nums text-muted-foreground">{Math.round(f.value * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-muted-foreground/80" title={d.virality.basis.length < d.sources.length ? `Based on ${d.virality.basis.map(nameOf).join(", ")}` : undefined}>
                    How fast attention grows against your usual level — not whether it&apos;s positive.
                  </p>
                </>
              )}
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

const DONUT = ["var(--entity-1)", "var(--entity-2)", "var(--entity-3)", "var(--entity-4)", "var(--entity-5)"];

/** Platform share as a donut (top five in identity colours, the rest grey) with a legend that filters the graph. */
function PlatformDonut({ items, total, active, hrefFor }: { items: Array<{ id: string; label: string; value: number }>; total: number; active: string | null; hrefFor: (id: string) => string }) {
  const sum = items.reduce((a, i) => a + i.value, 0);
  if (sum === 0) return <p className="grid min-h-40 place-content-center rounded-xl border border-dashed text-[13px] text-muted-foreground">No relevant mentions in this period.</p>;
  const top = items.slice(0, 5);
  const rest = items.slice(5);
  const slices = [...top.map((x, i) => ({ ...x, color: DONUT[i]! })), ...(rest.length ? [{ id: "", label: `${rest.length} other${rest.length === 1 ? "" : "s"}`, value: rest.reduce((a, x) => a + x.value, 0), color: "color-mix(in oklab, var(--foreground) 22%, transparent)" }] : [])];
  const r = 62, c = 2 * Math.PI * r, gap = slices.length > 1 ? 6 : 0;
  let acc = 0;
  return (
    <div className="grid items-center gap-6 sm:grid-cols-[200px_minmax(0,1fr)]">
      <div className="relative mx-auto size-[200px]">
        <svg viewBox="0 0 160 160" className="size-full -rotate-90" aria-hidden>
          {slices.map((sl, i) => {
            const len = (sl.value / sum) * c;
            const el = (
              <circle key={sl.label} cx="80" cy="80" r={r} fill="none" stroke={sl.color} strokeWidth="18"
                strokeDasharray={`${Math.max(0.5, len - gap)} ${c}`} strokeDashoffset={-acc}
                className="fade-in" style={{ ["--d" as string]: `${500 + i * 90}ms`, opacity: active && sl.id !== active ? 0.3 : 1 }} />
            );
            acc += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <CountUp value={total} className="text-[32px] font-semibold leading-none tracking-[-0.04em]" />
          <span className="mt-1 text-[12px] text-muted-foreground/80">mentions</span>
        </div>
      </div>
      <ul className="grid gap-1" aria-label="Mentions by platform">
        {items.map((it, i) => {
          const color = i < 5 ? DONUT[i]! : "color-mix(in oklab, var(--foreground) 22%, transparent)";
          const on = active === it.id;
          return (
            <li key={it.id} className={i >= 7 ? "hidden" : undefined}>
              <Link href={hrefFor(it.id)} scroll={false} aria-current={on ? "true" : undefined}
                className={cn("flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-[13px] transition-colors hover:bg-foreground/[0.04]", on && "bg-foreground/[0.06]")}>
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                <span className="tabular-nums text-[12px] text-muted-foreground">{it.value} · {Math.round((it.value / sum) * 100)}%</span>
              </Link>
            </li>
          );
        })}
        {items.length > 7 && <li className="px-2 pt-1 text-[12px] text-muted-foreground">+{items.length - 7} more platforms</li>}
      </ul>
    </div>
  );
}

function GrowthLine({ growth }: { growth: Growth }) {
  const Icon = growth.change === 0 ? Minus : growth.change === null || growth.change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("flex items-center gap-1 text-[12px]", !growth.reliable ? "text-warning" : growth.change !== null && growth.change < 0 ? "text-signal" : growth.change ? "text-positive" : "text-muted-foreground")}
      title={!growth.reliable ? "Compares periods that weren't fully monitored" : undefined}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{growth.label}{growth.change !== null && ` (was ${formatCount(growth.previous)})`}</span>
    </span>
  );
}

function Momentum({ i, label, value, growth, hint }: { i: number; label: string; value: number; growth: Growth | null; hint?: string }) {
  return (
    <div className="panel rise grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-[18px] p-4" style={{ ["--d" as string]: `${160 + i * 60}ms` }}>
      <span className="truncate text-[12px] text-muted-foreground">{label}</span>
      <CountUp value={value} className="text-[26px] font-semibold leading-none tracking-[-0.03em]" />
      {growth ? <GrowthLine growth={growth} /> : <span className="text-[12px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** Monitoring coverage as a ring (red when under half the period was monitored). */
function Ring({ value }: { value: number }) {
  const c = 2 * Math.PI * 22;
  const low = value < 0.5;
  return (
    <svg viewBox="0 0 56 56" className="size-12 shrink-0 -rotate-90" aria-hidden>
      <circle cx="28" cy="28" r="22" fill="none" stroke="color-mix(in oklab, var(--foreground) 8%, transparent)" strokeWidth="6" />
      {value > 0 && <circle cx="28" cy="28" r="22" fill="none" stroke={low ? "var(--signal)" : "var(--foreground)"} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${value * c} ${c}`} className="ring-fill" style={{ ["--len" as string]: c, ["--d" as string]: "500ms" }} />}
    </svg>
  );
}

/** Virality as a half gauge, 0–100; red from 70. */
function Gauge({ score, confidence }: { score: number; confidence: string }) {
  const len = Math.PI * 70;
  const hot = score >= 70;
  return (
    <div className="relative mx-auto w-full max-w-[220px]">
      <svg viewBox="0 0 180 100" className="w-full" aria-hidden>
        <path d="M20 90 A70 70 0 0 1 160 90" fill="none" stroke="color-mix(in oklab, var(--foreground) 8%, transparent)" strokeWidth="14" strokeLinecap="round" />
        {score > 0 && <path d="M20 90 A70 70 0 0 1 160 90" fill="none" stroke={hot ? "var(--signal)" : "var(--foreground)"} strokeWidth="14" strokeLinecap="round"
          strokeDasharray={`${(score / 100) * len} ${len}`} className="ring-fill" style={{ ["--len" as string]: len, ["--d" as string]: "600ms",
            filter: hot ? "drop-shadow(0 0 8px color-mix(in oklab, var(--signal) 60%, transparent))" : undefined }} />}
      </svg>
      <div className="absolute inset-x-0 bottom-0 grid justify-items-center">
        <span className="text-[34px] font-semibold leading-none tracking-[-0.04em] tabular" aria-label={`Virality ${score} out of 100`}>{score}</span>
        <span className="text-[11px] text-muted-foreground">/ 100 · {confidence} confidence</span>
      </div>
    </div>
  );
}

function Distribution({ items, empty, label }: { items: Array<{ label: string; value: number }>; empty: string; label: string }) {
  const total = items.reduce((a, i) => a + i.value, 0);
  if (total === 0) return <p className="text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="grid gap-2" aria-label={label}>
      {[...items].sort((a, b) => b.value - a.value).map((i) => (
        <li key={i.label} className="flex justify-between gap-2 text-[12px]"><span className="truncate text-foreground/85">{i.label}</span><span className="shrink-0 whitespace-nowrap tabular text-muted-foreground">{i.value} · {Math.round((i.value / total) * 100)}%</span></li>
      ))}
    </ul>
  );
}

export const dynamic = "force-dynamic";
