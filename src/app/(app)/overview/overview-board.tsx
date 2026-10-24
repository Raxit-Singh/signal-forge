"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight, ChevronRight, ExternalLink } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CountUp, EASE_OUT, GLIDE, Rise } from "@/components/motion";
import { RelativeTime } from "@/components/time";
import { cn } from "@/lib/utils";

// Overview — command center. Each job gets its own form: a stacked area for who drives volume
// over time, a donut for the platform mix, a gauge for sentiment, a heatmap for when people
// talk, rings and a sparkline inside the KPI tiles. On first load panels rise in order, numbers
// count up, arcs and lines draw in; live refreshes only roll changed numbers and slide in new
// feed items. Reduced motion keeps fades and drops movement.

export interface OverviewData {
  product: string;
  period: string;
  kpis: {
    mentions: number; mentionsChange: number | null;
    today: number; yesterday: number;
    negativeShare: number | null; classified: number;
    openIssues: number; highIssues: number; priorities: { critical: number; high: number; medium: number; low: number };
    sov: number | null; competitors: number;
  };
  series: Array<{ label: string; full: string; value: number | null; by: Record<string, number>; other: number }>;
  stackKeys: Array<{ id: string; name: string; color: string }>;
  heat: number[][];
  platforms: Array<{ id: string; name: string; value: number; prev: number; color: string }>;
  otherPlatforms: { count: number; value: number };
  issues: Array<{ id: string; title: string; kind: string; kindColor: string; people: number; trend: string | null; priority: string | null }>;
  voice: Array<{ name: string; share: number | null; isProduct: boolean; color: string }>;
  sentiment: { positive: number; neutral: number; negative: number; classified: number } | null;
  feed: Array<{ id: string; platform: string; author: string | null; text: string; url: string; at: string; sentiment: string | null }>;
}

const PRIORITY_COLOR: Record<string, string> = { critical: "var(--negative)", high: "var(--negative)", medium: "var(--warning)", low: "var(--muted-foreground)" };
const SENTIMENT_COLOR: Record<string, string> = { positive: "var(--sentiment-positive)", negative: "var(--sentiment-negative)" };
const OTHER = "var(--sentiment-neutral)";
const fmt = (n: number) => n.toLocaleString("en-US");

/** Recharts draws its own entrance; run it on first load only, never on live refreshes. */
function useFirstRender(ms = 1400) {
  const [first, setFirst] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setFirst(false), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return first;
}

function Delta({ value, invert = false, className }: { value: number | null; invert?: boolean; className?: string }) {
  if (value === null || !Number.isFinite(value)) return null;
  const pct = Math.round(value * 100);
  const good = invert ? pct < 0 : pct > 0;
  const Icon = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : null;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular", pct === 0 ? "text-muted-foreground" : good ? "text-positive" : "text-negative", className)}>
      {Icon && <Icon className="size-3.5" aria-hidden />}{pct > 0 ? "+" : pct < 0 ? "−" : ""}{Math.abs(pct)}%
    </span>
  );
}

function Panel({ title, href, action, index, className, children, flush = false, aside }: {
  title: string; href?: string; action?: string; index: number; className?: string; children: React.ReactNode; flush?: boolean; aside?: React.ReactNode;
}) {
  return (
    <Rise index={index} className={cn("flex min-w-0 flex-col rounded-xl border bg-surface shadow-panel", className)}>
      <header className="flex h-11 items-center justify-between gap-2 border-b px-4">
        <h2 className="truncate text-[12px] font-medium uppercase tracking-[0.05em] text-muted-foreground">{title}</h2>
        <div className="flex items-center gap-3">
          {aside}
          {href && (
            <Link href={href} className="group inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
              {action}<ChevronRight className="size-3.5 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:translate-x-0.5" aria-hidden />
            </Link>
          )}
        </div>
      </header>
      <div className={cn("min-w-0 flex-1", !flush && "p-4")}>{children}</div>
    </Rise>
  );
}

// ---------------------------------------------------------------- KPI tiles

function Ring({ value, color, delay = 0 }: { value: number; color: string; delay?: number }) {
  const r = 17, len = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value));
  return (
    <svg viewBox="0 0 44 44" className="size-11 shrink-0 -rotate-90" aria-hidden>
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--muted)" strokeWidth="5" />
      <circle cx="22" cy="22" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" className="ring-fill"
        strokeDasharray={len} strokeDashoffset={len * (1 - v)} style={{ ["--len" as string]: `${len}`, ["--d" as string]: `${delay}ms` }} />
    </svg>
  );
}

function Spark({ data }: { data: OverviewData["series"] }) {
  const first = useFirstRender();
  return (
    <div className="h-11 w-24 shrink-0" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="linear" dataKey="value" stroke="var(--primary)" strokeWidth={1.75} fill="url(#spark-fill)" isAnimationActive={first} animationDuration={1000} animationEasing="ease-out" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Kpi({ label, index, children, foot, viz }: { label: string; index: number; children: React.ReactNode; foot: React.ReactNode; viz?: React.ReactNode }) {
  return (
    <Rise index={index} className="flex min-w-0 items-center gap-3 rounded-xl border bg-surface px-4 py-3.5 shadow-panel">
      <div className="grid min-w-0 flex-1 gap-1.5">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <span className="text-[26px] font-semibold leading-none tracking-[-0.02em]">{children}</span>
        <span className="truncate text-xs text-muted-foreground">{foot}</span>
      </div>
      {viz}
    </Rise>
  );
}

function PriorityStack({ p }: { p: OverviewData["kpis"]["priorities"] }) {
  const total = p.critical + p.high + p.medium + p.low;
  if (!total) return null;
  const parts = [["critical", p.critical], ["high", p.high], ["medium", p.medium], ["low", p.low]] as const;
  return (
    <div className="flex h-11 w-3 shrink-0 flex-col-reverse gap-0.5 overflow-hidden rounded-full" aria-hidden>
      {parts.filter(([, n]) => n > 0).map(([k, n], i) => (
        <span key={k} className="rise w-full rounded-[2px]" style={{ height: `${(n / total) * 100}%`, background: PRIORITY_COLOR[k], ["--d" as string]: `${300 + i * 60}ms` }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Mentions over time

function Segmented<T extends string>({ value, options, onChange, id }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; id: string }) {
  return (
    <div role="radiogroup" className="relative flex rounded-md bg-muted p-0.5 text-[11px]">
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn("relative h-6 rounded px-2 font-medium transition-colors", value === v ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
          {value === v && <motion.span layoutId={`seg-${id}`} transition={GLIDE} className="absolute inset-0 rounded bg-surface shadow-sm" aria-hidden />}
          <span className="relative">{label}</span>
        </button>
      ))}
    </div>
  );
}

function TrendTooltip({ active, payload, stacked, keys }: { active?: boolean; payload?: Array<{ payload: OverviewData["series"][number] }>; stacked: boolean; keys: OverviewData["stackKeys"] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0]!.payload;
  return (
    <div className="min-w-40 rounded-lg border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground">{r.full}</p>
      <p className="mt-0.5 text-[13px] font-semibold tabular">{r.value === null ? "Not monitored" : `${fmt(r.value)} mentions`}</p>
      {stacked && r.value !== null && (
        <ul className="mt-1.5 grid gap-0.5">
          {keys.map((k) => <li key={k.id} className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: k.color }} /><span className="flex-1">{k.name}</span><span className="tabular">{r.by[k.id] ?? 0}</span></li>)}
          {r.other > 0 && <li className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: OTHER }} /><span className="flex-1">Other</span><span className="tabular">{r.other}</span></li>}
        </ul>
      )}
    </div>
  );
}

function Trend({ d }: { d: OverviewData }) {
  const [mode, setMode] = useState<"total" | "platform">("platform");
  const data = d.series.map((s) => ({ ...s, ...Object.fromEntries(d.stackKeys.map((k) => [k.id, s.value === null ? null : s.by[k.id] ?? 0])), __other: s.value === null ? null : s.other }));
  return (
    <Panel index={5} title="Mentions over time" href="/buzz" action="Trends" className="lg:col-span-8"
      aside={<Segmented id="trend" value={mode} onChange={setMode} options={[["platform", "By platform"], ["total", "Total"]]} />}>
      {d.series.some((s) => s.value !== null) ? (
        <div className="grid gap-3">
          <div className="h-[268px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 6, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="ov-total" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} interval="preserveStartEnd" minTickGap={28} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={38} allowDecimals={false} />
                <Tooltip cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "2 3" }} content={<TrendTooltip stacked={mode === "platform"} keys={d.stackKeys} />} />
                {mode === "total" ? (
                  <Area key="total" type="linear" dataKey="value" stroke="var(--primary)" strokeWidth={2} fill="url(#ov-total)" connectNulls={false}
                    animationDuration={700} animationEasing="ease-out"
                    activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: "var(--primary)" }} />
                ) : (
                  [...d.stackKeys.map((k) => ({ id: k.id, color: k.color })), { id: "__other", color: OTHER }].map((k) => (
                    <Area key={k.id} type="linear" dataKey={k.id} stackId="p" stroke={k.color} strokeWidth={1.25} fill={k.color} fillOpacity={0.55}
                      connectNulls={false} animationDuration={700} animationEasing="ease-out" activeDot={false} />
                  ))
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {mode === "platform" && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
              {d.stackKeys.map((k) => <li key={k.id} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: k.color }} />{k.name}</li>)}
              <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: OTHER }} />Other</li>
            </ul>
          )}
        </div>
      ) : <p className="py-16 text-center text-[13px] text-muted-foreground">Nothing monitored in this period yet.</p>}
    </Panel>
  );
}

// ---------------------------------------------------------------- Platform mix (donut)

function PlatformMix({ d }: { d: OverviewData }) {
  const first = useFirstRender();
  const [hover, setHover] = useState<number | null>(null);
  const slices = [...d.platforms.map((p) => ({ name: p.name, value: p.value, color: p.color })),
    ...(d.otherPlatforms.value > 0 ? [{ name: `${d.otherPlatforms.count} more`, value: d.otherPlatforms.value, color: OTHER }] : [])];
  const total = slices.reduce((t, s) => t + s.value, 0);
  const focus = hover !== null ? slices[hover] : null;
  return (
    <Panel index={6} title="Platform mix" href="/integrations" action="Sources" className="lg:col-span-4">
      {total === 0 ? <p className="py-16 text-center text-[13px] text-muted-foreground">No mentions yet.</p> : (
        <div className="grid gap-4">
          <div className="relative mx-auto size-[184px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius={64} outerRadius={88} paddingAngle={2} cornerRadius={4} stroke="none"
                  startAngle={90} endAngle={-270} isAnimationActive={first} animationBegin={250} animationDuration={1000} animationEasing="ease-out"
                  onMouseEnter={(_, i) => setHover(i)} onMouseLeave={() => setHover(null)}>
                  {slices.map((s, i) => <Cell key={s.name} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.35} style={{ transition: "opacity 150ms ease" }} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
              <span className="text-[24px] font-semibold leading-none tracking-[-0.02em]">{focus ? fmt(focus.value) : <CountUp value={total} />}</span>
              <span className="mt-1 max-w-28 truncate text-xs text-muted-foreground">{focus ? `${focus.name} · ${Math.round((focus.value / total) * 100)}%` : "mentions"}</span>
            </div>
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]" aria-label="Mentions by platform">
            {slices.map((s, i) => (
              <li key={s.name} className="flex min-w-0 items-center gap-2" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="tabular text-muted-foreground">{Math.round((s.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- When people talk (heatmap)

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hourLabel = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);
const heatColor = (t: number) => (t <= 0 ? "var(--muted)" : `color-mix(in oklch, var(--primary) ${18 + Math.round(t * 82)}%, var(--muted))`);

function Heatmap({ d }: { d: OverviewData }) {
  const max = Math.max(1, ...d.heat.flat());
  const [cell, setCell] = useState<[number, number] | null>(null);
  let peak: [number, number] = [0, 0];
  d.heat.forEach((row, i) => row.forEach((v, h) => { if (v > d.heat[peak[0]]![peak[1]]!) peak = [i, h]; }));
  const shown = cell ?? peak;
  const v = d.heat[shown[0]]![shown[1]]!;
  return (
    <Panel index={7} title="When people talk" className="lg:col-span-5">
      <p className="mb-3 text-[13px]">
        <span className="font-medium">{DAYS[shown[0]]} {hourLabel(shown[1])}–{hourLabel((shown[1] + 1) % 24)}</span>
        <span className="text-muted-foreground"> · {v} mention{v === 1 ? "" : "s"}{!cell && v > 0 ? " · busiest hour" : ""}</span>
      </p>
      <div className="grid grid-cols-[28px_1fr] gap-x-2" role="img" aria-label={`Mentions by weekday and hour. Busiest: ${DAYS[peak[0]]} ${hourLabel(peak[1])}.`}>
        <div className="grid grid-rows-7 gap-[3px] text-[10px] leading-none text-muted-foreground">
          {DAYS.map((day) => <span key={day} className="flex items-center">{day}</span>)}
        </div>
        <div className="grid gap-[3px]" onMouseLeave={() => setCell(null)}>
          {d.heat.map((row, i) => (
            <div key={i} className="grid grid-cols-24 gap-[3px]">
              {row.map((n, h) => (
                <span key={h} onMouseEnter={() => setCell([i, h])}
                  className={cn("fade-in aspect-square min-h-2 rounded-[3px] outline outline-1", cell && cell[0] === i && cell[1] === h ? "outline-foreground" : "outline-transparent")}
                  style={{ background: heatColor(n / max), ["--d" as string]: `${200 + h * 18}ms` }} />
              ))}
            </div>
          ))}
          <div className="mt-1 grid grid-cols-24 text-[10px] text-muted-foreground">
            {Array.from({ length: 24 }, (_, h) => <span key={h} className={h % 6 ? "invisible" : ""}>{hourLabel(h)}</span>)}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
        Fewer
        {[0, 0.25, 0.5, 0.75, 1].map((t) => <span key={t} className="size-2.5 rounded-[3px]" style={{ background: heatColor(t) }} />)}
        More
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- Sentiment (gauge)

function Sentiment({ d }: { d: OverviewData }) {
  const first = useFirstRender();
  const s = d.sentiment;
  const total = s ? s.positive + s.neutral + s.negative : 0;
  const net = s && total ? Math.round(((s.positive - s.negative) / total) * 100) : 0;
  const data = s ? [
    { name: "Positive", value: s.positive, color: "var(--sentiment-positive)" },
    { name: "Neutral", value: s.neutral, color: OTHER },
    { name: "Negative", value: s.negative, color: "var(--sentiment-negative)" },
  ] : [];
  return (
    <Panel index={8} title="Sentiment" href="/feedback" action="Feedback" className="lg:col-span-3">
      {!s || total === 0 ? <p className="py-16 text-center text-[13px] text-muted-foreground">Not enough classified mentions yet.</p> : (
        <div className="grid gap-3">
          <div className="relative mx-auto h-[108px] w-[196px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" cx="50%" cy="100%" startAngle={180} endAngle={0} innerRadius={68} outerRadius={92} paddingAngle={2} cornerRadius={4} stroke="none"
                  isAnimationActive={first} animationBegin={300} animationDuration={1000} animationEasing="ease-out">
                  {data.map((x) => <Cell key={x.name} fill={x.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-x-0 bottom-0 grid justify-items-center">
              <span className={cn("text-[26px] font-semibold leading-none tracking-[-0.02em]", net > 0 ? "text-positive" : net < 0 ? "text-negative" : "")}>
                <CountUp value={net} format={{ signDisplay: "exceptZero" }} />
              </span>
              <span className="mt-1 text-xs text-muted-foreground">net sentiment</span>
            </div>
          </div>
          <ul className="grid gap-1.5 text-[13px]">
            {data.map((x) => (
              <li key={x.name} className="flex items-center gap-2">
                <span className="size-2.5 rounded-sm" style={{ background: x.color }} aria-hidden />
                <span className="flex-1">{x.name}</span>
                <span className="tabular text-muted-foreground">{Math.round((x.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- Share of voice

function Voice({ d }: { d: OverviewData }) {
  return (
    <Panel index={9} title="Share of voice" href="/competitors" action="Competitors" className="lg:col-span-4">
      {d.voice.length > 1 && d.voice.some((v) => v.share !== null) ? (
        <ul className="grid gap-3.5 text-[13px]">
          {d.voice.map((v, i) => (
            <li key={v.name} className="grid gap-1.5">
              <div className="flex items-baseline gap-2">
                <span className={cn("min-w-0 flex-1 truncate", v.isProduct && "font-medium")}>{v.name}</span>
                <span className="font-medium tabular">{v.share === null ? "—" : `${Math.round(v.share * 100)}%`}</span>
              </div>
              <span className="block h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span className="grow-x block h-full rounded-full" style={{ width: `${(v.share ?? 0) * 100}%`, background: v.color, ["--d" as string]: `${400 + i * 70}ms` }} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid h-full content-center gap-3 py-4 text-center">
          <div className="mx-auto flex -space-x-2" aria-hidden>
            {["var(--entity-1)", "var(--entity-2)", "var(--entity-3)"].map((c, i) => <span key={c} className="rise size-8 rounded-full border-2 border-surface" style={{ background: c, ["--d" as string]: `${400 + i * 80}ms` }} />)}
          </div>
          <p className="text-[13px] text-muted-foreground">See how much people talk about {d.product} compared with your competitors.</p>
          <Link href="/competitors" className="press mx-auto inline-flex h-8 items-center rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground">Add a competitor</Link>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- Issues and feed

function Issues({ d }: { d: OverviewData }) {
  return (
    <Panel index={10} title="Open issues" href="/feedback" action="Triage" className="lg:col-span-7" flush>
      {d.issues.length === 0 ? <p className="px-4 py-12 text-center text-[13px] text-muted-foreground">No open issues. Issues appear once two or more people report the same thing.</p> : (
        <table className="w-full table-fixed text-[13px]">
          <thead className="text-left text-[11px] uppercase tracking-[0.05em] text-muted-foreground">
            <tr className="border-b">
              <th className="py-2.5 pl-4 font-medium">Issue</th>
              <th className="w-16 text-right font-medium">People</th>
              <th className="hidden w-32 pl-5 font-medium xl:table-cell">Trend</th>
              <th className="w-28 pl-5 pr-4 font-medium">Priority</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {d.issues.map((i, n) => (
              <tr key={i.id} className="fade-in group transition-colors hover:bg-muted/50" style={{ ["--d" as string]: `${450 + n * 40}ms` }}>
                <td className="py-3 pl-4">
                  <Link href={`/feedback#issue-${i.id}`} className="flex min-w-0 items-center gap-2">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: i.kindColor }} aria-label={i.kind} />
                    <span className="truncate group-hover:underline group-hover:underline-offset-4">{i.title}</span>
                  </Link>
                </td>
                <td className="text-right font-medium tabular">{i.people}</td>
                <td className="hidden whitespace-nowrap pl-5 text-muted-foreground xl:table-cell">{i.trend ?? "—"}</td>
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
  );
}

function Feed({ d }: { d: OverviewData }) {
  return (
    <Panel index={11} title="Live feed" href="/mentions" action="All mentions" className="lg:col-span-5" flush>
      {d.feed.length === 0 ? <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">No mentions collected yet.</p> : (
        <ul className="divide-y">
          <AnimatePresence initial={false}>
            {d.feed.map((m) => (
              <motion.li key={m.id} layout="position" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }}>
                <a href={m.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="group grid gap-0.5 px-4 py-2.5 text-[13px] transition-colors hover:bg-muted/50">
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: SENTIMENT_COLOR[m.sentiment ?? ""] ?? OTHER }} aria-label={`${m.sentiment ?? "unclassified"} sentiment`} />
                    {m.author && <span className="truncate font-medium text-foreground">{m.author}</span>}
                    <span className="shrink-0">{m.platform}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1 tabular"><RelativeTime value={m.at} /><ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden /></span>
                  </span>
                  <span className="line-clamp-1 min-w-0" dir="auto">{m.text}</span>
                </a>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- Board

export function OverviewBoard({ d }: { d: OverviewData }) {
  const k = d.kpis;
  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <section aria-label="Key numbers" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-12 lg:grid-cols-5">
        <Kpi index={0} label={`Mentions · ${d.period}`} viz={<Spark data={d.series} />}
          foot={k.mentionsChange === null ? "No earlier period to compare" : <span className="inline-flex items-center gap-1.5"><Delta value={k.mentionsChange} /><span>vs previous</span></span>}>
          <CountUp value={k.mentions} />
        </Kpi>
        <Kpi index={1} label="So far today" foot={`Yesterday: ${fmt(k.yesterday)}`}
          viz={k.yesterday > 0 ? <Ring value={k.today / Math.max(k.today, k.yesterday)} color="var(--entity-2)" delay={150} /> : undefined}>
          <CountUp value={k.today} />
        </Kpi>
        <Kpi index={2} label="Negative share" foot={k.classified ? `of ${fmt(k.classified)} classified` : "Nothing classified yet"}
          viz={k.negativeShare !== null ? <Ring value={k.negativeShare} color="var(--sentiment-negative)" delay={250} /> : undefined}>
          {k.negativeShare === null ? <span className="text-muted-foreground">—</span> : <CountUp value={k.negativeShare} format={{ style: "percent" }} />}
        </Kpi>
        <Kpi index={3} label="Open issues" viz={<PriorityStack p={k.priorities} />}
          foot={k.highIssues ? <span className="text-negative">{k.highIssues} high priority</span> : "None high priority"}>
          <CountUp value={k.openIssues} />
        </Kpi>
        <Kpi index={4} label="Share of voice"
          viz={k.sov !== null ? <Ring value={k.sov} color="var(--primary)" delay={350} /> : undefined}
          foot={k.competitors ? `vs ${k.competitors} competitor${k.competitors === 1 ? "" : "s"}` : <Link href="/competitors" className="underline underline-offset-2 hover:text-foreground">Add competitors</Link>}>
          {k.sov === null ? <span className="text-muted-foreground">—</span> : <CountUp value={k.sov} format={{ style: "percent" }} />}
        </Kpi>
      </section>

      <Trend d={d} />
      <PlatformMix d={d} />
      <Heatmap d={d} />
      <Sentiment d={d} />
      <Voice d={d} />
      <Issues d={d} />
      <Feed d={d} />
    </div>
  );
}
