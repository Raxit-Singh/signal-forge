"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight, ChevronRight, ExternalLink } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CountUp, EASE_OUT, GrowBar, Rise } from "@/components/motion";
import { RelativeTime } from "@/components/time";
import { cn } from "@/lib/utils";

// Overview — command center. Every panel rises into place in order on first load; bars grow,
// numbers count up, the trend draws in. Live refreshes don't replay any of it: new feed items
// slide in, changed numbers roll. Reduced motion keeps the fades and drops the movement.

export interface OverviewData {
  product: string;
  period: string;
  kpis: {
    mentions: number; mentionsChange: number | null;
    today: number; yesterday: number;
    negativeShare: number | null; classified: number;
    openIssues: number; highIssues: number;
    sov: number | null; competitors: number;
  };
  series: Array<{ label: string; full: string; value: number | null }>;
  platforms: Array<{ id: string; name: string; value: number; prev: number; color: string }>;
  otherPlatforms: { count: number; value: number };
  issues: Array<{ id: string; title: string; kind: string; kindColor: string; people: number; trend: string | null; priority: string | null }>;
  voice: Array<{ name: string; share: number | null; isProduct: boolean; color: string }>;
  sentiment: { positive: number; neutral: number; negative: number; classified: number } | null;
  feed: Array<{ id: string; platform: string; author: string | null; text: string; url: string; at: string; sentiment: string | null }>;
}

const PRIORITY_COLOR: Record<string, string> = { critical: "var(--negative)", high: "var(--negative)", medium: "var(--warning)", low: "var(--muted-foreground)" };
const SENTIMENT_COLOR: Record<string, string> = { positive: "var(--sentiment-positive)", negative: "var(--sentiment-negative)" };
const pctChange = (a: number, b: number) => (b > 0 ? (a - b) / b : null);

function Delta({ value, invert = false, className }: { value: number | null; invert?: boolean; className?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
  const pct = Math.round(value * 100);
  const good = invert ? pct < 0 : pct > 0;
  const Icon = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : null;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular", pct === 0 ? "text-muted-foreground" : good ? "text-positive" : "text-negative", className)}>
      {Icon && <Icon className="size-3.5" aria-hidden />}{pct > 0 ? "+" : pct < 0 ? "−" : ""}{Math.abs(pct)}%
    </span>
  );
}

function Panel({ title, href, action, index, className, children, flush = false }: {
  title: string; href?: string; action?: string; index: number; className?: string; children: React.ReactNode; flush?: boolean;
}) {
  return (
    <Rise index={index} className={cn("flex min-w-0 flex-col rounded-xl border bg-surface shadow-panel", className)}>
      <header className="flex h-11 items-center justify-between gap-2 border-b px-4">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.05em] text-muted-foreground">{title}</h2>
        {href && (
          <Link href={href} className="group inline-flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            {action}<ChevronRight className="size-3.5 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:translate-x-0.5" aria-hidden />
          </Link>
        )}
      </header>
      <div className={cn("min-w-0 flex-1", !flush && "p-4")}>{children}</div>
    </Rise>
  );
}

function Kpi({ label, index, children, foot }: { label: string; index: number; children: React.ReactNode; foot: React.ReactNode }) {
  return (
    <Rise index={index} className="grid min-w-0 gap-1.5 rounded-xl border bg-surface px-4 py-3.5 shadow-panel">
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className="text-[26px] font-semibold leading-none tracking-[-0.02em]">{children}</span>
      <span className="truncate text-xs text-muted-foreground">{foot}</span>
    </Rise>
  );
}

function Trend({ data }: { data: OverviewData["series"] }) {
  // Draw the line in on first load only; live refreshes update it in place.
  const [first, setFirst] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setFirst(false), 1200);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="h-[260px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 6, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id="ov-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--entity-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--entity-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} interval="preserveStartEnd" minTickGap={28} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={38} allowDecimals={false} />
          <Tooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "2 3" }}
            content={({ active, payload }) => active && payload?.length ? (
              <div className="rounded-lg border bg-surface px-3 py-2 text-xs shadow-lg">
                <p className="text-muted-foreground">{(payload[0]!.payload as OverviewData["series"][number]).full}</p>
                <p className="mt-0.5 text-[13px] font-semibold tabular">{payload[0]!.value ?? "Not monitored"}{payload[0]!.value !== null && " mentions"}</p>
              </div>
            ) : null}
          />
          <Area type="linear" dataKey="value" stroke="var(--entity-1)" strokeWidth={2} fill="url(#ov-fill)" connectNulls={false}
            isAnimationActive={first} animationDuration={900} animationEasing="ease-out"
            activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: "var(--entity-1)" }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OverviewBoard({ d }: { d: OverviewData }) {
  const k = d.kpis;
  const max = Math.max(1, ...d.platforms.map((p) => p.value));
  const sentTotal = d.sentiment ? d.sentiment.positive + d.sentiment.neutral + d.sentiment.negative : 0;
  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-12 lg:grid-cols-5">
        <Kpi index={0} label={`Mentions · ${d.period}`} foot={<Delta value={k.mentionsChange} />}>
          <CountUp value={k.mentions} />
        </Kpi>
        <Kpi index={1} label="Today" foot={<span className="inline-flex items-center gap-1.5"><Delta value={pctChange(k.today, k.yesterday)} /><span>vs yesterday</span></span>}>
          <CountUp value={k.today} />
        </Kpi>
        <Kpi index={2} label="Negative share" foot={k.classified ? `of ${k.classified.toLocaleString("en-US")} classified` : "Nothing classified yet"}>
          {k.negativeShare === null ? <span className="text-muted-foreground">—</span> : <CountUp value={k.negativeShare} format={{ style: "percent" }} />}
        </Kpi>
        <Kpi index={3} label="Open issues" foot={k.highIssues ? <span className="text-negative">{k.highIssues} high priority</span> : "None high priority"}>
          <CountUp value={k.openIssues} />
        </Kpi>
        <Kpi index={4} label="Share of voice" foot={k.competitors ? `vs ${k.competitors} competitor${k.competitors === 1 ? "" : "s"}` : <Link href="/competitors" className="underline underline-offset-2 hover:text-foreground">Add competitors</Link>}>
          {k.sov === null ? <span className="text-muted-foreground">—</span> : <CountUp value={k.sov} format={{ style: "percent" }} />}
        </Kpi>
      </section>

      <Panel index={5} title="Mentions over time" href="/buzz" action="Trends" className="lg:col-span-8">
        {d.series.some((s) => s.value !== null) ? <Trend data={d.series} /> : <p className="py-16 text-center text-[13px] text-muted-foreground">Nothing monitored in this period yet.</p>}
      </Panel>

      <Panel index={6} title={`By platform · ${d.period}`} href="/integrations" action="Sources" className="lg:col-span-4">
        {d.platforms.length === 0 ? <p className="py-10 text-center text-[13px] text-muted-foreground">No mentions yet.</p> : (
          <ul className="grid gap-3" aria-label="Mentions by platform">
            {d.platforms.map((p, i) => (
              <li key={p.id} className="grid grid-cols-[minmax(0,92px)_1fr_auto_auto] items-center gap-2.5 text-[13px]">
                <span className="truncate">{p.name}</span>
                <GrowBar value={p.value / max} color={p.color} delay={0.25 + i * 0.05} />
                <span className="w-10 text-right font-medium tabular">{p.value.toLocaleString("en-US")}</span>
                <Delta value={pctChange(p.value, p.prev)} className="w-14 justify-end text-[11px]" />
              </li>
            ))}
            {d.otherPlatforms.count > 0 && <li className="text-xs text-muted-foreground">+{d.otherPlatforms.count} quieter platform{d.otherPlatforms.count === 1 ? "" : "s"} · {d.otherPlatforms.value} mentions</li>}
          </ul>
        )}
      </Panel>

      <Panel index={7} title="Open issues" href="/feedback" action="Triage" className="lg:col-span-8" flush>
        {d.issues.length === 0 ? <p className="px-4 py-12 text-center text-[13px] text-muted-foreground">No open issues. Issues appear once two or more people report the same thing.</p> : (
          <table className="w-full table-fixed text-[13px]">
            <thead className="text-left text-[11px] uppercase tracking-[0.05em] text-muted-foreground">
              <tr className="border-b">
                <th className="py-2.5 pl-4 font-medium">Issue</th>
                <th className="hidden w-40 font-medium xl:table-cell">Kind</th>
                <th className="w-16 text-right font-medium">People</th>
                <th className="hidden w-32 pl-5 font-medium 2xl:table-cell">Trend</th>
                <th className="w-28 pl-5 pr-4 font-medium">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {d.issues.map((i, n) => (
                <tr key={i.id} className="fade-in group transition-colors hover:bg-muted/50" style={{ ["--d" as string]: `${350 + n * 40}ms` }}>
                  <td className="py-3 pl-4">
                    <Link href={`/feedback#issue-${i.id}`} className="flex min-w-0 items-center gap-2">
                      <span className="size-1.5 shrink-0 rounded-full xl:hidden" style={{ background: i.kindColor }} aria-label={i.kind} />
                      <span className="truncate group-hover:underline group-hover:underline-offset-4">{i.title}</span>
                    </Link>
                  </td>
                  <td className="hidden whitespace-nowrap text-muted-foreground xl:table-cell">
                    <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full" style={{ background: i.kindColor }} aria-hidden />{i.kind}</span>
                  </td>
                  <td className="text-right font-medium tabular">{i.people}</td>
                  <td className="hidden whitespace-nowrap pl-5 text-muted-foreground 2xl:table-cell">{i.trend ?? "—"}</td>
                  <td className="whitespace-nowrap pl-5 pr-4">
                    {i.priority ? (
                      <span className="inline-flex items-center gap-1.5 capitalize">
                        <span className="relative flex size-2">
                          {(i.priority === "high" || i.priority === "critical") && <span className="pulse-ring absolute inset-0 rounded-full" style={{ background: PRIORITY_COLOR[i.priority] }} aria-hidden />}
                          <span className="relative size-2 rounded-full" style={{ background: PRIORITY_COLOR[i.priority] }} />
                        </span>
                        {i.priority}
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel index={8} title="Share of voice" href="/competitors" action="Competitors" className="lg:col-span-4">
        {d.voice.length > 1 && d.voice.some((v) => v.share !== null) ? (
          <>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
              {d.voice.map((v, i) => (
                <span key={v.name} className="grow-x h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(v.share ?? 0) * 100}%`, background: v.color, ["--d" as string]: `${400 + i * 80}ms` }} />
              ))}
            </div>
            <ul className="mt-3.5 grid gap-2 text-[13px]">
              {d.voice.map((v) => (
                <li key={v.name} className="flex items-center gap-2">
                  <span className="size-2 rounded-sm" style={{ background: v.color }} aria-hidden />
                  <span className={cn("flex-1 truncate", v.isProduct && "font-medium")}>{v.name}</span>
                  <span className="tabular">{v.share === null ? "—" : `${Math.round(v.share * 100)}%`}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="grid gap-2 py-2 text-[13px]">
            <p className="text-muted-foreground">Compare how much people talk about {d.product} against your competitors.</p>
            <Link href="/competitors" className="w-fit text-primary underline-offset-4 hover:underline">Add a competitor</Link>
          </div>
        )}
        <div className="mt-4 grid gap-2 border-t pt-3.5">
          <span className="text-xs text-muted-foreground">Sentiment toward {d.product}</span>
          {d.sentiment && sentTotal > 0 ? (
            <>
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
                {([["positive", "var(--sentiment-positive)"], ["neutral", "var(--sentiment-neutral)"], ["negative", "var(--sentiment-negative)"]] as const).map(([key, color], i) => (
                  <span key={key} className="grow-x h-full" style={{ width: `${(d.sentiment![key] / sentTotal) * 100}%`, background: color, ["--d" as string]: `${500 + i * 80}ms` }} />
                ))}
              </div>
              <div className="flex justify-between text-xs tabular text-muted-foreground">
                <span><span className="font-medium text-foreground">{Math.round((d.sentiment.positive / sentTotal) * 100)}%</span> positive</span>
                <span><span className="font-medium text-foreground">{Math.round((d.sentiment.negative / sentTotal) * 100)}%</span> negative</span>
              </div>
            </>
          ) : <span className="text-xs text-muted-foreground">Not enough classified mentions yet.</span>}
        </div>
      </Panel>

      <Panel index={9} title="Live feed" href="/mentions" action="All mentions" className="lg:col-span-12" flush>
        {d.feed.length === 0 ? <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">No mentions collected yet.</p> : (
          <ul className="divide-y">
            <AnimatePresence initial={false}>
              {d.feed.map((m) => (
                <motion.li key={m.id} layout="position"
                  initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease: EASE_OUT }}>
                  <a href={m.url} target="_blank" rel="noopener noreferrer nofollow ugc"
                    className="group grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px] transition-colors hover:bg-muted/50 sm:grid-cols-[auto_120px_1fr_auto]">
                    <span className="size-1.5 rounded-full" style={{ background: SENTIMENT_COLOR[m.sentiment ?? ""] ?? "var(--sentiment-neutral)" }} aria-label={`${m.sentiment ?? "unclassified"} sentiment`} />
                    <span className="hidden truncate text-muted-foreground sm:block">{m.platform}</span>
                    <span className="min-w-0 truncate" dir="auto">
                      {m.author && <span className="font-medium">{m.author} </span>}
                      <span className="text-muted-foreground">{m.text}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-xs tabular text-muted-foreground">
                      <RelativeTime value={m.at} />
                      <ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                    </span>
                  </a>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Panel>
    </div>
  );
}
