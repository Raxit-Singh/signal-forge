"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Bug, ChevronRight, Clock, Download, Inbox, MessageSquare, Plus, Sparkles, TrendingUp, Waypoints } from "lucide-react";
import { CountUp } from "@/components/motion";
import { Periods } from "@/components/periods";
import { cn } from "@/lib/utils";

// Overview in the Obsidian style: one signal red, used only for what needs attention (the worst
// day, the bug topic, the busiest hour, the primary action); everything else is foreground ink.

export interface OverviewData {
  product: string;
  greeting: string;
  name: string | null;
  rangeKey: string;
  period: string;
  from: string;
  to: string;
  total: number;
  change: number | null;
  perDay: number;
  sentiment: { positive: number; negative: number } | null;
  sourcesLive: number;
  topIssue: { id: string; title: string } | null;
  mix: Array<{ name: string; share: number; change: number | null; value: number }>;
  platforms: Array<{ id: string; name: string; value: number; change: number | null; line: number[] }>;
  chart: Array<{ label: string; full: string; chip: string; all: number; negative: number | null }>;
  hourly: boolean;
  week: Array<{ d: string; share: number | null; classified: number }>;
  kinds: Array<{ name: string; v: number }>;
  openIssues: number;
  flow: { from: Array<{ id: string; name: string; v: number }>; to: Array<{ id: string; name: string; v: number }>; links: Array<[string, string, number]> };
  heat: number[][];
  feed: Array<{ id: string; platform: string; author: string | null; text: string; url: string; at: string; sentiment: string | null }>;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (n: number) => `${Math.round(n * 100)}%`;
const vars = (v: Record<string, string | number | undefined>) => v as React.CSSProperties;
/** Foreground ink at an opacity: white on dark, near-black on light. */
const ink = (a: number) => `color-mix(in oklab, var(--foreground) ${Math.round(a * 100)}%, transparent)`;

/** Monotone cubic path (no overshoot between points, so the curve never invents values). */
function smoothPath(pts: Array<[number, number]>) {
  if (pts.length < 2) return pts.length ? `M${pts[0]![0]},${pts[0]![1]}` : "";
  const n = pts.length, dx: number[] = [], m: number[] = [], t: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1]![0] - pts[i]![0]; m[i] = (pts[i + 1]![1] - pts[i]![1]) / dx[i]!; }
  t[0] = m[0]!; t[n - 1] = m[n - 2]!;
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2;
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!, h = dx[i]! / 3;
    d += ` C${x0 + h},${y0 + t[i]! * h} ${x1 - h},${y1 - t[i + 1]! * h} ${x1},${y1}`;
  }
  return d;
}

function Delta({ v, className }: { v: number | null; className?: string }) {
  if (v === null || !Number.isFinite(v)) return null;
  const p = Math.round(v * 100);
  const up = p >= 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[12px] font-medium tabular-nums", up ? "text-positive" : "text-signal", className)}>
      {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}{up ? "+" : "−"}{Math.abs(p)}%
    </span>
  );
}

function Card({ d, className, children }: { d: number; className?: string; children: React.ReactNode }) {
  return <section className={cn("panel rise grid h-full content-start gap-4 rounded-[18px] p-5", className)} style={vars({ "--d": `${d}ms` })}>{children}</section>;
}

function CardHead({ title, icon: Icon, value, sub, href, action }: {
  title: string; icon: typeof Bug; value?: React.ReactNode; sub?: React.ReactNode; href?: string; action?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="grid min-w-0 gap-1">
        <h2 className="flex items-center gap-2 text-[13px] font-normal text-muted-foreground"><Icon className="size-3.5" aria-hidden />{title}</h2>
        {value !== undefined && <span className="text-[26px] font-semibold leading-none tracking-[-0.03em]">{value}</span>}
        {sub && <span className="text-[12px] text-muted-foreground">{sub}</span>}
      </div>
      {href && (
        <Link href={href} className="press panel flex h-8 shrink-0 items-center gap-0.5 rounded-full pl-3 pr-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground">
          {action}<ChevronRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="grid min-h-40 place-content-center rounded-xl border border-dashed px-4 text-center text-[13px] text-muted-foreground">{children}</p>;
}

// ---------------------------------------------------------------- hero

/** Where the conversation is: the top platforms' shares as bars (the largest in red), the rest striped. */
function MixBar({ d }: { d: OverviewData }) {
  if (d.mix.length === 0) return <Empty>No mentions in this period yet.</Empty>;
  return (
    <div className="grid content-end gap-3">
      <div className="flex items-baseline justify-between gap-3 text-[13px] text-muted-foreground">
        <span>Where the conversation is</span>
        <span className="tabular-nums">≈ {fmt(d.perDay)} a day</span>
      </div>
      <div className="mt-3 flex items-end gap-3">
        {d.mix.map((m, i) => {
          const kind = i === 0 ? "solid" : i < 3 ? "dense" : "sparse";
          return (
            <div key={m.name} className="rise grid min-w-0 gap-2" style={vars({ flex: Math.max(m.share, 0.08), "--d": `${120 + i * 90}ms` })} title={`${m.name}: ${fmt(m.value)} mentions`}>
              <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap text-[13px]">
                <span className={kind === "solid" ? "font-semibold" : "font-medium text-foreground/85"}>{pct(m.share)}</span>
                <span className="truncate text-muted-foreground">{m.name}</span>
              </div>
              <div className="grow-y h-[86px]" style={vars({
                "--d": `${300 + i * 110}ms`,
                background: kind === "solid"
                  ? "linear-gradient(180deg, color-mix(in oklab, var(--signal) 80%, white), var(--signal))"
                  : kind === "dense"
                    ? `repeating-linear-gradient(90deg, ${ink(0.72)} 0 5px, transparent 5px 11px)`
                    : `repeating-linear-gradient(90deg, ${ink(0.3)} 0 5px, transparent 5px 14px)`,
                boxShadow: kind === "solid" ? "0 10px 40px -10px color-mix(in oklab, var(--signal) 70%, transparent)" : undefined,
                borderRadius: kind === "solid" ? 14 : 6,
              })} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[12px] text-muted-foreground/80"><span>{d.from}</span><span>{d.to}</span></div>
    </div>
  );
}

function Hero({ d }: { d: OverviewData }) {
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="rise grid content-start gap-6">
        <h1 className="text-[34px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]">
          {d.greeting}{d.name && <>, <span className="text-foreground/45">{d.name}</span></>}
        </h1>
        <div className="grid gap-2">
          <span className="text-[14px] text-muted-foreground">{d.product} · mentions, {d.period}</span>
          <div className="flex flex-wrap items-center gap-3">
            <CountUp value={d.total} className="text-[56px] font-semibold leading-none tracking-[-0.045em] sm:text-[64px]" />
            {d.change !== null && (
              <span className={cn("panel flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] tabular-nums", d.change >= 0 ? "text-positive" : "text-signal")}>
                {d.change >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
                {d.change >= 0 ? "+" : "−"}{Math.abs(Math.round(d.change * 1000) / 10)}%
                <span className="sr-only"> vs the previous period</span>
              </span>
            )}
          </div>
          <span className="text-[14px] text-muted-foreground">
            {d.sentiment && <>Positive <span className="text-foreground">{pct(d.sentiment.positive)}</span> · Negative <span className="text-signal">{pct(d.sentiment.negative)}</span> · </>}
            {d.sourcesLive} {d.sourcesLive === 1 ? "source" : "sources"} live
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {d.topIssue ? (
            <Link href={`/feedback#issue-${d.topIssue.id}`} title={d.topIssue.title}
              className="press flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[14px] font-medium text-primary-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_8px_24px_-8px_color-mix(in_oklab,var(--signal)_80%,transparent)]">
              <Sparkles className="size-4" aria-hidden />Investigate top issue
            </Link>
          ) : (
            <Link href="/mentions" className="press flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[14px] font-medium text-primary-foreground">
              <MessageSquare className="size-4" aria-hidden />Read mentions
            </Link>
          )}
          <Link href="/reports" className="press panel flex h-11 items-center gap-2 rounded-full px-5 text-[14px] transition-colors hover:bg-foreground/[0.06]">
            <Download className="size-4" aria-hidden />Reports
          </Link>
        </div>
      </div>
      <div className="rise grid content-between gap-5" style={vars({ "--d": "120ms" })}>
        <div className="flex justify-end"><Periods value={d.rangeKey} /></div>
        <MixBar d={d} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- platforms

function Sparkline({ data, red, delay }: { data: number[]; red: boolean; delay: number }) {
  const id = `sp${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const pts = data.map((v, i) => [(i / Math.max(1, data.length - 1)) * 100, 34 - ((v - min) / (max - min || 1)) * 28] as [number, number]);
  const path = smoothPath(pts);
  return (
    <svg viewBox="0 0 100 40" className="h-10 w-[100px] shrink-0" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={red ? "var(--signal)" : "var(--foreground)"} stopOpacity={red ? 0.3 : 0.16} />
          <stop offset="100%" stopColor="var(--foreground)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L100,40 L0,40 Z`} fill={`url(#${id})`} className="fade-in" style={vars({ "--d": `${delay + 400}ms` })} />
      <path d={path} fill="none" stroke={red ? "var(--signal)" : ink(0.85)} strokeWidth="1.6" pathLength={1} className="draw" style={vars({ "--d": `${delay}ms` })} />
    </svg>
  );
}

function Platforms({ d }: { d: OverviewData }) {
  if (d.platforms.length === 0) return null;
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Top platforms">
      {d.platforms.map((s, i) => (
        <div key={s.id} className="panel lift rise grid gap-4 rounded-[18px] p-4" style={vars({ "--d": `${180 + i * 70}ms` })}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-foreground/[0.04] text-[11px] font-semibold text-foreground">{s.name.slice(0, 1)}</span>
              <span className="truncate">{s.name}</span>
            </span>
            <Delta v={s.change} />
          </div>
          <div className="flex items-end justify-between gap-2">
            <div className="grid gap-0.5">
              <CountUp value={s.value} className="text-[24px] font-semibold leading-none tracking-[-0.03em]" />
              <span className="text-[12px] text-muted-foreground/80">{d.period}</span>
            </div>
            <Sparkline data={s.line} red={(s.change ?? 0) < 0} delay={300 + i * 80} />
          </div>
        </div>
      ))}
      <Link href="/competitors"
        className={cn("press rise grid place-content-center gap-1 rounded-[18px] border border-dashed p-4 text-center text-[13px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground",
          d.platforms.length % 2 === 0 && "hidden xl:grid")}
        style={vars({ "--d": "460ms" })}>
        <span className="mx-auto mb-1 flex size-9 items-center justify-center rounded-full border"><Plus className="size-4" aria-hidden /></span>
        Compare with a competitor<span className="text-[11px] text-muted-foreground/80">See who owns the conversation</span>
      </Link>
    </section>
  );
}

// ---------------------------------------------------------------- mentions chart

function MainChart({ d }: { d: OverviewData }) {
  // Drawn at the container's real pixel width (no stretching), re-measured on resize.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pts = d.chart;
  const n = pts.length;
  const H = 250, PAD = 12;
  const max = Math.max(1, ...pts.map((p) => p.all)) * 1.12;
  const x = (i: number) => PAD + (n > 1 ? i / (n - 1) : 0.5) * (W - PAD * 2);
  const y = (v: number) => H - 18 - (v / max) * (H - 40);
  const hasNeg = pts.some((p) => p.negative !== null);
  const paths = useMemo(() => {
    const px = (i: number) => PAD + (n > 1 ? i / (n - 1) : 0.5) * (W - PAD * 2);
    const py = (v: number) => H - 18 - (v / max) * (H - 40);
    return {
      all: smoothPath(pts.map((p, i) => [px(i), py(p.all)])),
      neg: hasNeg ? smoothPath(pts.map((p, i) => [px(i), py(p.negative ?? 0)])) : "",
    };
  }, [pts, n, W, max, hasNeg]);
  const peak = pts.reduce((b, p, i) => (p.all > pts[b]!.all ? i : b), 0);
  const [sel, setSel] = useState(peak);
  const at = Math.min(sel, Math.max(0, n - 1));
  const onMove = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    setSel(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - PAD) / (r.width - PAD * 2)) * (n - 1)))));
  };
  const left = (x(at) / W) * 100;
  const chips = !d.hourly && n <= 31;
  const p = pts[at];
  return (
    <Card d={420}>
      <CardHead title="Mentions" icon={TrendingUp} value={<CountUp value={d.total} />} sub={d.period} href="/buzz" action="Trends" />
      {!p ? <Empty>No mentions in this period yet.</Empty> : (
        <>
          <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-foreground" />All</span>
            {hasNeg && <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-signal" />Negative</span>}
          </div>
          <div ref={box} className="dots relative h-[250px] cursor-crosshair touch-pan-y rounded-xl" onPointerMove={onMove} onPointerDown={onMove}>
            <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full overflow-visible" role="img" aria-label={`Mentions per ${d.hourly ? "hour" : "day"}${hasNeg ? ", all and negative" : ""}`}>
              <defs>
                <linearGradient id="ov-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--foreground)" stopOpacity="0.13" /><stop offset="100%" stopColor="var(--foreground)" stopOpacity="0" /></linearGradient>
                <filter id="ov-glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
              </defs>
              <path d={`${paths.all} L${x(n - 1)},${H} L${x(0)},${H} Z`} fill="url(#ov-area)" className="fade-in" style={vars({ "--d": "900ms" })} />
              <path d={paths.all} fill="none" stroke="var(--foreground)" strokeWidth="2" pathLength={1} className="draw" style={vars({ "--d": "500ms" })} />
              {hasNeg && <path d={paths.neg} fill="none" stroke="var(--signal)" strokeWidth="2" pathLength={1} filter="url(#ov-glow)" className="draw" style={vars({ "--d": "700ms" })} />}
            </svg>
            <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground/20 transition-[left] duration-150 ease-out" style={{ left: `${left}%` }} />
            <span className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-foreground transition-[left,top] duration-150 ease-out"
              style={{ left: `${left}%`, top: `${(y(p.all) / H) * 100}%` }} />
            {p.negative !== null && (
              <span className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-signal shadow-[var(--signal-glow)] transition-[left,top] duration-150 ease-out"
                style={{ left: `${left}%`, top: `${(y(p.negative) / H) * 100}%` }} />
            )}
            <div className="pointer-events-none absolute top-3 rounded-lg border bg-surface/95 px-3 py-2 text-[12px] shadow-xl transition-[left] duration-150 ease-out"
              style={{ left: `clamp(8px, calc(${left}% + 12px), calc(100% - 180px))` }}>
              <p className="text-muted-foreground">{p.full}</p>
              <p className="mt-1 flex items-center gap-1.5 tabular-nums"><span className="size-1.5 rounded-full bg-foreground" />{fmt(p.all)} mentions</p>
              {p.negative !== null && <p className="flex items-center gap-1.5 tabular-nums text-signal"><span className="size-1.5 rounded-full bg-signal" />{fmt(p.negative)} negative</p>}
            </div>
          </div>
          {chips && (
            <div className="grid gap-1 max-sm:hidden" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
              {pts.map((q, i) => (
                <button key={i} type="button" onClick={() => setSel(i)} aria-label={q.full} aria-pressed={i === at}
                  className={cn("mx-auto flex aspect-square w-full max-w-7 items-center justify-center rounded-full text-[10px] tabular-nums transition-colors",
                    i === at ? "bg-foreground font-semibold text-background" : "border border-foreground/[0.08] text-muted-foreground/80 hover:text-foreground")}>{q.chip}</button>
              ))}
            </div>
          )}
          <div className={cn("flex justify-between text-[11px] text-muted-foreground/80", chips && "sm:hidden")}><span>{pts[0]!.label}</span><span>{pts[Math.floor(n / 2)]!.label}</span><span>{pts[n - 1]!.label}</span></div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- negative by weekday

function Capsules({ d }: { d: OverviewData }) {
  const known = d.week.filter((w) => w.share !== null);
  const worst = d.week.reduce((w, x, i) => ((x.share ?? -1) > (d.week[w]!.share ?? -1) ? i : w), 0);
  const top = Math.max(0.01, ...known.map((w) => w.share!));
  const [hover, setHover] = useState<number | null>(null);
  const shown = d.week[hover ?? worst]!;
  return (
    <Card d={500}>
      <CardHead title="Negative by weekday" icon={Bug}
        value={known.length ? (shown.share === null ? "—" : <CountUp value={Math.round(shown.share * 100)} suffix="%" />) : undefined}
        sub={known.length ? `${shown.d}${hover === null ? " · most negative day" : ` · ${fmt(shown.classified)} classified`}` : undefined} />
      {known.length === 0 ? <Empty>Sentiment appears once mentions are classified.</Empty> : (
        <div className="flex h-[218px] items-end justify-between gap-2" onMouseLeave={() => setHover(null)}>
          {d.week.map((w, i) => (
            <button key={w.d} type="button" className="grid h-full flex-1 grid-rows-[1fr_auto] justify-items-center gap-2"
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              aria-label={`${w.d}: ${w.share === null ? "no data" : `${pct(w.share)} negative`}`}>
              <span className="relative flex h-full w-full max-w-9 items-end overflow-hidden rounded-full bg-gradient-to-b from-foreground/[0.07] to-foreground/[0.02]">
                <span className="grow-y w-full rounded-full" style={vars({
                  height: `${Math.max(4, ((w.share ?? 0) / top) * 100)}%`, "--d": `${600 + i * 70}ms`,
                  background: i === worst ? "linear-gradient(180deg, color-mix(in oklab, var(--signal) 75%, white), var(--signal))" : `linear-gradient(180deg, ${ink(0.42)}, ${ink(0.12)})`,
                  boxShadow: i === worst ? "0 0 28px color-mix(in oklab, var(--signal) 55%, transparent)" : undefined,
                  opacity: hover === null || hover === i ? 1 : 0.45, transition: "opacity 160ms ease",
                })} />
              </span>
              <span className={cn("text-[12px]", i === worst ? "font-medium text-foreground" : "text-muted-foreground/80")}>{w.d}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- issues by kind

function IssueDonut({ d }: { d: OverviewData }) {
  const r = 62, c = 2 * Math.PI * r;
  const sum = d.kinds.reduce((t, k) => t + k.v, 0);
  const gap = d.kinds.length > 1 ? 10 : 0;
  const starts = d.kinds.map((_, i) => d.kinds.slice(0, i).reduce((t, k) => t + (k.v / Math.max(1, sum)) * c, 0));
  const colors = (d.kinds[0]?.name === "Bugs" ? ["var(--signal)"] : []).concat([ink(0.85), ink(0.55), ink(0.32), ink(0.18), ink(0.12)]);
  return (
    <Card d={580}>
      <CardHead title="Open issues by kind" icon={Inbox} href="/feedback" action="Issues" />
      {sum === 0 ? <Empty>No open issues. New ones appear as reports come in.</Empty> : (
        <>
          <div className="relative mx-auto size-[170px]">
            <svg viewBox="0 0 160 160" className="size-full -rotate-90" role="img" aria-label="Open issues by kind">
              {d.kinds.map((k, i) => (
                <circle key={k.name} cx="80" cy="80" r={r} fill="none" stroke={colors[i] ?? ink(0.14)} strokeWidth="16" strokeLinecap={gap ? "round" : "butt"}
                  strokeDasharray={`${Math.max(0.5, (k.v / sum) * c - gap)} ${c}`} strokeDashoffset={-starts[i]!}
                  className="fade-in" style={vars({ "--d": `${700 + i * 120}ms`, filter: colors[i] === "var(--signal)" ? "drop-shadow(0 0 8px color-mix(in oklab, var(--signal) 60%, transparent))" : undefined })} />
              ))}
            </svg>
            <div className="absolute inset-0 grid place-content-center text-center">
              <CountUp value={d.openIssues} className="text-[30px] font-semibold leading-none tracking-[-0.03em]" />
              <span className="mt-1 text-[12px] text-muted-foreground/80">open issues</span>
            </div>
          </div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px] xl:grid-cols-1">
            {d.kinds.map((k, i) => (
              <li key={k.name} className="flex items-center gap-2">
                <span className="h-3 w-1 rounded-full" style={{ background: colors[i] ?? ink(0.14), boxShadow: colors[i] === "var(--signal)" ? "var(--signal-glow)" : undefined }} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{k.name}</span>
                <span className="tabular-nums">{k.v}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- platform → topic flow

function Flow({ d }: { d: OverviewData }) {
  const { from, to, links } = d.flow;
  // Drawn at the card's real width so labels keep their size; ribbons take what's left between them.
  const box = useRef<HTMLDivElement>(null);
  const [CW, setCW] = useState(480);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCW(Math.max(260, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const LEFT = 92, RIGHT = 118;
  const W = CW - LEFT - RIGHT, H = 300, NODE = 12, GAP = 12;
  const total = from.reduce((t, n) => t + n.v, 0);
  const [hover, setHover] = useState<string | null>(null);
  if (total === 0) {
    return <Card d={660}><CardHead title="From platforms to topics" icon={Waypoints} /><div ref={box}><Empty>Topics appear once mentions are classified.</Empty></div></Card>;
  }
  const scaleL = (H - GAP * (from.length - 1)) / total;
  const scaleR = (H - GAP * (to.length - 1)) / total;
  const yL: Record<string, number> = {}, yR: Record<string, number> = {};
  let acc = 0; for (const n of from) { yL[n.id] = acc; acc += n.v * scaleL + GAP; }
  acc = 0; for (const n of to) { yR[n.id] = acc; acc += n.v * scaleR + GAP; }
  const outL = { ...yL }, inR = { ...yR };
  const ribbons = links.map(([a, b, v]) => {
    const h1 = v * scaleL, h2 = v * scaleR;
    const y1 = outL[a]!, y2 = inR[b]!;
    outL[a] = y1 + h1; inR[b] = y2 + h2;
    const x0 = NODE, x1 = W - NODE, mx = W / 2;
    return { a, b, v, d: `M${x0},${y1} C${mx},${y1} ${mx},${y2} ${x1},${y2} L${x1},${y2 + h2} C${mx},${y2 + h2} ${mx},${y1 + h1} ${x0},${y1 + h1} Z` };
  });
  const short = (s: string) => (s.length > 11 ? `${s.slice(0, 10)}…` : s);
  return (
    <Card d={660}>
      <CardHead title="From platforms to topics" icon={Waypoints} value={<CountUp value={total} />} sub="classified mentions on the top platforms" />
      <div ref={box}>
      <svg viewBox={`${-LEFT} 0 ${CW} ${H}`} width={CW} height={H} className="block max-w-full overflow-visible" role="img" aria-label="Mentions flowing from platforms to topics">
        <defs>
          <linearGradient id="ov-flow-red" x1="0" x2="1"><stop offset="0%" stopColor="var(--signal)" stopOpacity="0.15" /><stop offset="100%" stopColor="var(--signal)" stopOpacity="0.55" /></linearGradient>
        </defs>
        {ribbons.map((p, i) => (
          <path key={i} d={p.d} fill={p.b === "bug" ? "url(#ov-flow-red)" : ink(0.09)} className="fade-in"
            style={vars({ "--d": `${800 + i * 40}ms`, opacity: hover !== null && hover !== p.a && hover !== p.b ? 0.25 : 1, transition: "opacity 180ms ease" })}>
            <title>{`${from.find((f) => f.id === p.a)?.name} → ${to.find((t) => t.id === p.b)?.name}: ${fmt(p.v)}`}</title>
          </path>
        ))}
        {from.map((n) => (
          <g key={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}>
            <rect x={0} y={yL[n.id]} width={NODE} height={Math.max(2, n.v * scaleL)} rx={3} fill={ink(0.85)} />
            <text x={-8} y={yL[n.id]! + (n.v * scaleL) / 2} textAnchor="end" dominantBaseline="middle" className="fill-foreground text-[13px]">{short(n.name)}</text>
            <text x={-8} y={yL[n.id]! + (n.v * scaleL) / 2 + 16} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[12px]">{fmt(n.v)}</text>
          </g>
        ))}
        {to.map((n) => (
          <g key={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}>
            <rect x={W - NODE} y={yR[n.id]} width={NODE} height={Math.max(2, n.v * scaleR)} rx={3} fill={n.id === "bug" ? "var(--signal)" : ink(0.85)}
              style={n.id === "bug" ? { filter: "drop-shadow(0 0 6px color-mix(in oklab, var(--signal) 80%, transparent))" } : undefined} />
            <text x={W + 8} y={yR[n.id]! + (n.v * scaleR) / 2} dominantBaseline="middle" className={n.id === "bug" ? "fill-signal text-[13px]" : "fill-foreground text-[13px]"}>{n.name}</text>
            <text x={W + 8} y={yR[n.id]! + (n.v * scaleR) / 2 + 16} dominantBaseline="middle" className="fill-muted-foreground text-[12px]">{fmt(n.v)}</text>
          </g>
        ))}
      </svg>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- when people talk

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hourLabel = (h: number) => (h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`);

function PixelHeat({ d }: { d: OverviewData }) {
  let peak: [number, number] = [0, 0];
  d.heat.forEach((row, a) => row.forEach((v, h) => { if (v > d.heat[peak[0]]![peak[1]]!) peak = [a, h]; }));
  const max = d.heat[peak[0]]![peak[1]]!;
  const [cell, setCell] = useState<[number, number] | null>(null);
  const shown = cell ?? peak;
  const count = d.heat[shown[0]]![shown[1]]!;
  const shade = (v: number) => (v === 0 ? ink(0.05) : ink(0.12 + (v / max) * 0.78));
  const until = (h: number) => hourLabel((h + 1) % 24);
  return (
    <Card d={740}>
      <CardHead title="When people talk" icon={Clock}
        value={max > 0 ? <span className="text-[22px]">{DAYS[shown[0]]} {hourLabel(shown[1])}–{until(shown[1])}</span> : undefined}
        sub={max > 0 ? (cell ? `${fmt(count)} ${count === 1 ? "mention" : "mentions"} in this hour, ${d.period}` : `busiest hour · ${fmt(count)} ${count === 1 ? "mention" : "mentions"}`) : undefined} />
      {max === 0 ? <Empty>Not enough dated mentions in this period.</Empty> : (
        <>
          <div className="grid gap-[3px]" onMouseLeave={() => setCell(null)}
            role="img" aria-label={`Mentions by weekday and hour, ${d.from} to ${d.to}; busiest ${DAYS[peak[0]]} ${hourLabel(peak[1])}`}>
            {d.heat.map((row, a) => (
              <div key={a} className="flex items-center gap-2">
                <span className={cn("w-8 shrink-0 text-[11px]", a === shown[0] ? "text-foreground" : "text-muted-foreground/80")}>{DAYS[a]}</span>
                <div className="grid min-w-0 flex-1 grid-cols-24 gap-[3px]">
                  {row.map((v, h) => {
                    const hot = a === peak[0] && h === peak[1];
                    return (
                      <span key={h} onMouseEnter={() => setCell([a, h])} className="pop aspect-square w-full rounded-[3px]"
                        style={vars({
                          "--d": `${850 + (a * 24 + h) * 3}ms`,
                          background: hot ? "var(--signal)" : shade(v),
                          boxShadow: hot ? "0 0 12px color-mix(in oklab, var(--signal) 90%, transparent)" : cell && cell[0] === a && cell[1] === h ? "0 0 0 1.5px var(--foreground)" : undefined,
                        })} />
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="flex gap-2 pt-1 text-[11px] text-muted-foreground/80" aria-hidden>
              <span className="w-8 shrink-0" />
              <div className="grid flex-1 grid-cols-4"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span></div>
            </div>
          </div>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-foreground/[0.06] pt-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              Fewer
              {[0, 0.25, 0.5, 0.75, 1].map((t) => <span key={t} className="size-3 rounded-[3px]" style={{ background: t === 0 ? ink(0.05) : ink(0.12 + t * 0.78) }} />)}
              More
            </span>
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-signal shadow-[var(--signal-glow)]" />Busiest hour</span>
            <span>Darkest: no mentions</span>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- latest mentions

function ago(iso: string, now: number) {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

function Recent({ d }: { d: OverviewData }) {
  // Relative times only after hydration, so server and client markup agree.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { const t = requestAnimationFrame(() => setNow(Date.now())); return () => cancelAnimationFrame(t); }, []);
  return (
    <Card d={620} className="gap-2">
      <CardHead title="Latest mentions" icon={MessageSquare} href="/mentions" action="See all" />
      {d.feed.length === 0 ? <Empty>No mentions yet.</Empty> : (
        <ul className="grid">
          {d.feed.map((m, i) => (
            <li key={m.id} className="rise border-b border-foreground/[0.06] last:border-b-0" style={vars({ "--d": `${760 + i * 70}ms` })}>
              <a href={m.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="group flex items-center gap-3 py-2.5">
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                  m.sentiment === "negative" ? "border-signal/40 bg-signal-soft text-signal" : "bg-foreground/[0.04]")}>
                  {m.platform.slice(0, 1)}
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="line-clamp-2 text-[13px] leading-snug group-hover:underline group-hover:underline-offset-2">{m.text}</span>
                  <span className="truncate text-[11px] text-muted-foreground/80">{m.author ? `${m.author} · ` : ""}{m.platform}</span>
                </span>
                <time dateTime={m.at} className="shrink-0 text-[11px] tabular-nums text-muted-foreground/80">{now === null ? "" : ago(m.at, now)}</time>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- page

export function OverviewBoard({ d }: { d: OverviewData }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 pb-10">
      <Hero d={d} />
      <Platforms d={d} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-12">
        <div className="sm:col-span-2 xl:col-span-6"><MainChart d={d} /></div>
        <div className="xl:col-span-3"><Capsules d={d} /></div>
        <div className="xl:col-span-3"><IssueDonut d={d} /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-12">
        <div className="sm:col-span-2 xl:order-2 xl:col-span-5"><Flow d={d} /></div>
        <div className="xl:order-1 xl:col-span-3"><Recent d={d} /></div>
        <div className="xl:order-3 xl:col-span-4"><PixelHeat d={d} /></div>
      </div>
    </div>
  );
}
