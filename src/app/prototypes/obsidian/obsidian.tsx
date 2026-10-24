"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight, ArrowUpRight, Bell, Bug, ChevronDown, Command, Download, FileText, Gauge, Inbox, LayoutGrid, Lightbulb,
  MessageSquare, MoreHorizontal, Plug, Plus, Search, Settings, Sparkles, Swords, TrendingUp, Zap,
} from "lucide-react";
import "./obsidian.css";

// "Obsidian" — sample dashboard. Black gradient + film grain (Vaulto), a big greeting and
// segmented hero numbers (Loud), clean card headers, donut and tooltips (Corelytics).
// One signal red, used only for what needs attention: the worst day, the biggest bug, the
// busiest hour, the primary action. Sample data shaped like a real product.

// ---------------------------------------------------------------- sample data

const DAYS = Array.from({ length: 21 }, (_, i) => i + 1);
const TOTAL = [412, 455, 430, 498, 520, 487, 560, 612, 590, 644, 702, 668, 731, 820, 905, 870, 948, 1012, 986, 1104, 1180];
const NEGATIVE = [88, 92, 101, 96, 110, 104, 131, 120, 142, 135, 168, 150, 176, 210, 248, 232, 205, 198, 220, 236, 214];
const WEEK = [
  { d: "Mon", v: 0.62, neg: 0.14 }, { d: "Tue", v: 0.48, neg: 0.12 }, { d: "Wed", v: 0.81, neg: 0.27 },
  { d: "Thu", v: 0.57, neg: 0.15 }, { d: "Fri", v: 0.74, neg: 0.18 }, { d: "Sat", v: 0.44, neg: 0.1 }, { d: "Sun", v: 0.66, neg: 0.13 },
];
const SOURCES = [
  { name: "X", mark: "𝕏", value: 4812, change: 17, line: [3, 4, 3.5, 5, 4.6, 6, 5.8, 7.2, 7, 8.4] },
  { name: "YouTube", mark: "▶", value: 3206, change: -8, line: [7, 6.4, 6.8, 6, 5.6, 5.9, 5.2, 5.4, 4.8, 5] },
  { name: "Reddit", mark: "r/", value: 2418, change: 25, line: [2, 2.4, 2.2, 3, 3.6, 3.3, 4.4, 5, 5.6, 6.4] },
  { name: "App Store", mark: "A", value: 1092, change: 4, line: [4, 4.2, 3.8, 4.4, 4.1, 4.6, 4.3, 4.8, 4.5, 4.9] },
];
const MIX = [
  { name: "X", share: 0.29, change: "+17%", kind: "solid" as const },
  { name: "YouTube", share: 0.19, change: "−8%", kind: "dense" as const },
  { name: "Reddit", share: 0.14, change: "+25%", kind: "dense" as const },
  { name: "13 others", share: 0.38, change: "1.2k", kind: "sparse" as const },
];
const FLOW = {
  from: [{ id: "x", name: "X", v: 4812 }, { id: "yt", name: "YouTube", v: 3206 }, { id: "rd", name: "Reddit", v: 2418 }],
  to: [{ id: "bug", name: "Bugs", v: 3120 }, { id: "cmp", name: "Complaints", v: 2650 }, { id: "ftr", name: "Feature requests", v: 2140 }, { id: "prs", name: "Praise", v: 2526 }],
  links: [
    ["x", "bug", 1500], ["x", "cmp", 1220], ["x", "ftr", 760], ["x", "prs", 1332],
    ["yt", "bug", 720], ["yt", "cmp", 830], ["yt", "ftr", 620], ["yt", "prs", 1036],
    ["rd", "bug", 900], ["rd", "cmp", 600], ["rd", "ftr", 760], ["rd", "prs", 158],
  ] as Array<[string, string, number]>,
};
const ISSUES = [
  { name: "Bugs", v: 41 }, { name: "Complaints", v: 26 }, { name: "Feature requests", v: 21 }, { name: "Questions", v: 12 },
];
const RECENT = [
  { who: "u/MPGamer18", src: "Reddit", text: "Crashes on the final chapter every single time", ago: "4m", tone: "neg" },
  { who: "Auld Gamers", src: "YouTube", text: "Act 3 walkthrough — the best set piece yet", ago: "22m", tone: "pos" },
  { who: "@coalitionfan", src: "X", text: "Horde mode is the best in the series", ago: "1h", tone: "pos" },
  { who: "kiran_m", src: "App Store", text: "Co-op servers drop every evening", ago: "2h", tone: "neg" },
];
// Weekday × hour (Mon..Sun × 24), evening-heavy, one hot spot.
const HEAT = WEEK.map((_, d) => Array.from({ length: 24 }, (_, h) => {
  const evening = Math.max(0, 1 - Math.abs(h - 20) / 6);
  const noon = Math.max(0, 1 - Math.abs(h - 13) / 3) * 0.5;
  const v = (evening + noon) * (0.55 + ((d * 7 + h * 3) % 10) / 20);
  return Math.min(1, v + (d === 2 && h === 21 ? 0.5 : 0));
}));

type NavItem = { label: string; icon: typeof LayoutGrid; active?: boolean; count?: number };
const NAV: Array<{ group: string; items: NavItem[] }> = [
  { group: "General", items: [{ label: "Overview", icon: LayoutGrid, active: true }, { label: "Mentions", icon: MessageSquare, count: 38 }, { label: "Issues", icon: Inbox, count: 5 }] },
  { group: "Insights", items: [{ label: "Trends", icon: TrendingUp }, { label: "Competitors", icon: Swords }, { label: "Insights", icon: Lightbulb }] },
  { group: "Other", items: [{ label: "Monitoring", icon: Gauge }, { label: "Sources", icon: Plug }, { label: "Reports", icon: FileText }] },
];

// ---------------------------------------------------------------- helpers

const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const style = (vars: Record<string, string | number | undefined>) => vars as React.CSSProperties;

/** Counts up from zero once on mount (rAF, 1.1s, strong ease-out); shows the real value before that. */
function useCountUp(target: number, delay = 0) {
  const [v, setV] = useState(target);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / 1100));
      setV(target * (1 - Math.pow(1 - t, 4)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, delay]);
  return v;
}

function Count({ to, digits = 0, delay = 0, className }: { to: number; digits?: number; delay?: number; className?: string }) {
  const v = useCountUp(to, delay);
  return <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(v, digits)}</span>;
}

/** Monotone cubic path (no overshoot between points, so the curve never invents values). */
function smoothPath(pts: Array<[number, number]>) {
  if (pts.length < 2) return "";
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

function Delta({ v, className = "" }: { v: number; className?: string }) {
  const up = v >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[12px] font-medium ${up ? "text-emerald-400" : "text-[var(--ob-red)]"} ${className}`}>
      {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}{up ? "+" : "−"}{Math.abs(v)}%
    </span>
  );
}

function CardHead({ title, value, action, icon: Icon }: { title: string; value?: React.ReactNode; action?: React.ReactNode; icon?: typeof Zap }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="grid gap-1">
        <span className="flex items-center gap-2 text-[13px] text-[var(--ob-dim)]">{Icon && <Icon className="size-3.5" aria-hidden />}{title}</span>
        {value && <span className="text-[26px] font-semibold leading-none tracking-[-0.03em]">{value}</span>}
      </div>
      {action ?? (
        <button className="ob-pill flex size-8 items-center justify-center text-[var(--ob-dim)] transition-colors hover:text-white" aria-label={`${title} options`}>
          <MoreHorizontal className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" className="ob-pill relative flex p-1 text-[13px]">
      {options.map((o) => (
        <button key={o} role="radio" aria-checked={o === value} onClick={() => onChange(o)}
          className={`relative h-8 rounded-full px-4 transition-colors duration-200 ${o === value ? "bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "text-[var(--ob-dim)] hover:text-white"}`}>
          {o}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function Sparkline({ data, red, d }: { data: number[]; red?: boolean; d: number }) {
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * 100, 34 - ((v - min) / (max - min || 1)) * 28] as [number, number]);
  const path = smoothPath(pts);
  return (
    <svg viewBox="0 0 100 40" className="h-10 w-[100px] shrink-0" aria-hidden>
      <path d={`${path} L100,40 L0,40 Z`} fill={red ? "url(#ob-spark-red)" : "url(#ob-spark-white)"} className="ob-fade" style={style({ "--d": `${d + 400}ms` })} />
      <path d={path} fill="none" stroke={red ? "var(--ob-red)" : "rgba(255,255,255,0.85)"} strokeWidth="1.6" pathLength={1}
        className="ob-draw" style={style({ "--len": 1, "--d": `${d}ms`, strokeDasharray: 1 })} />
    </svg>
  );
}

function SourceCard({ s, i }: { s: (typeof SOURCES)[number]; i: number }) {
  return (
    <div className="ob-card ob-card-hover ob-rise grid gap-4 p-4" style={style({ "--d": `${180 + i * 70}ms` })}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] text-[var(--ob-dim)]">
          <span className="flex size-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[11px] font-semibold text-white">{s.mark}</span>
          {s.name}
        </span>
        <Delta v={s.change} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="grid gap-0.5">
          <Count to={s.value} delay={200 + i * 70} className="text-[24px] font-semibold leading-none tracking-[-0.03em]" />
          <span className="text-[12px] text-[var(--ob-faint)]">this month</span>
        </div>
        <Sparkline data={s.line} red={s.change < 0} d={300 + i * 80} />
      </div>
    </div>
  );
}

function MixBar() {
  const avg = 0.62;
  return (
    <div className="relative grid h-full grid-rows-[auto_1fr_auto]">
      <div className="flex items-baseline justify-between text-[13px] text-[var(--ob-dim)]">
        <span>Where the conversation is</span>
        <span>Oct 1 — Oct 21</span>
      </div>
      <div className="relative mt-6 flex items-end gap-3">
        {/* average line */}
        <div className="pointer-events-none absolute inset-x-0 bottom-[52px] z-10 border-t border-dashed border-white/40" aria-hidden>
          <span className="ob-pill absolute -top-3 right-2 bg-[#0b0b0c] px-2.5 py-0.5 text-[11px] text-white/85">Average · {fmt(avg * 1000)}/day</span>
        </div>
        {MIX.map((m, i) => (
          <div key={m.name} className="ob-rise grid min-w-0 gap-2" style={style({ flex: m.share, "--d": `${120 + i * 90}ms` })}>
            <div className="flex items-baseline gap-1.5 whitespace-nowrap text-[13px]">
              <span className={m.kind === "solid" ? "font-semibold text-white" : "font-medium text-white/85"}>{m.change}</span>
              <span className="truncate text-[var(--ob-dim)]">{m.name}</span>
            </div>
            <div className="ob-grow-y h-[86px] rounded-xl" style={style({
              "--d": `${300 + i * 110}ms`,
              background: m.kind === "solid"
                ? "linear-gradient(180deg, #ff5a4f, var(--ob-red))"
                : m.kind === "dense"
                  ? "repeating-linear-gradient(90deg, rgba(255,255,255,0.78) 0 5px, transparent 5px 11px)"
                  : "repeating-linear-gradient(90deg, rgba(255,255,255,0.32) 0 5px, transparent 5px 14px)",
              boxShadow: m.kind === "solid" ? "0 10px 40px -10px rgba(255,59,47,0.7)" : undefined,
              borderRadius: m.kind === "solid" ? 14 : 6,
            })} />
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-between text-[12px] text-[var(--ob-faint)]"><span>October 1</span><span>October 21</span></div>
    </div>
  );
}

function MainChart() {
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
  const H = 250, PAD = 12;
  const max = Math.max(...TOTAL) * 1.1;
  const x = (i: number) => PAD + (i / (TOTAL.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - 18 - (v / max) * (H - 40);
  const total = useMemo(() => smoothPath(TOTAL.map((v, i) => [PAD + (i / (TOTAL.length - 1)) * (W - PAD * 2), H - 18 - (v / max) * (H - 40)])), [W, max]);
  const neg = useMemo(() => smoothPath(NEGATIVE.map((v, i) => [PAD + (i / (TOTAL.length - 1)) * (W - PAD * 2), H - 18 - ((v * 2.6) / max) * (H - 40)])), [W, max]);
  const [sel, setSel] = useState(14);
  const onMove = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (TOTAL.length - 1));
    setSel(Math.max(0, Math.min(TOTAL.length - 1, i)));
  };
  const left = (x(sel) / W) * 100;
  return (
    <div className="ob-card ob-rise grid h-full content-start gap-4 p-5" style={style({ "--d": "420ms" })}>
      <CardHead title="Mentions" icon={TrendingUp} value={<><Count to={16957} delay={400} /><span className="ml-2 align-middle text-[13px] font-normal text-[var(--ob-dim)]">this month</span></>}
        action={
          <div className="flex items-center gap-3 text-[12px] text-[var(--ob-dim)]">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-white" />All</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[var(--ob-red)]" />Negative</span>
          </div>
        } />
      <div ref={box} className="ob-dots relative h-[250px] cursor-crosshair rounded-xl" onPointerMove={onMove}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full overflow-visible" aria-label="Mentions per day, all and negative">
          <defs>
            <linearGradient id="ob-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#fff" stopOpacity="0.14" /><stop offset="100%" stopColor="#fff" stopOpacity="0" /></linearGradient>
            <linearGradient id="ob-spark-white" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#fff" stopOpacity="0.18" /><stop offset="100%" stopColor="#fff" stopOpacity="0" /></linearGradient>
            <linearGradient id="ob-spark-red" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#ff3b2f" stopOpacity="0.3" /><stop offset="100%" stopColor="#ff3b2f" stopOpacity="0" /></linearGradient>
            <filter id="ob-red-glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          <path d={`${total} L${x(TOTAL.length - 1)},${H} L${x(0)},${H} Z`} fill="url(#ob-area)" className="ob-fade" style={style({ "--d": "900ms" })} />
          <path d={total} fill="none" stroke="#fff" strokeWidth="2" pathLength={1} className="ob-draw" style={style({ "--len": 1, "--d": "500ms", strokeDasharray: 1 })} />
          <path d={neg} fill="none" stroke="var(--ob-red)" strokeWidth="2" pathLength={1} filter="url(#ob-red-glow)" className="ob-draw" style={style({ "--len": 1, "--d": "700ms", strokeDasharray: 1 })} />
        </svg>
        {/* crosshair + points + tooltip */}
        <div className="pointer-events-none absolute inset-y-0 w-px bg-white/20 transition-[left] duration-150 ease-out" style={{ left: `${left}%` }} />
        <span className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0b0b0c] bg-white transition-[left,top] duration-150 ease-out"
          style={{ left: `${left}%`, top: `${(y(TOTAL[sel]!) / H) * 100}%` }} />
        <span className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0b0b0c] bg-[var(--ob-red)] shadow-[var(--ob-glow)] transition-[left,top] duration-150 ease-out"
          style={{ left: `${left}%`, top: `${(y(NEGATIVE[sel]! * 2.6) / H) * 100}%` }} />
        <div className="pointer-events-none absolute top-3 rounded-lg border border-white/10 bg-[#0d0d0e]/95 px-3 py-2 text-[12px] shadow-xl transition-[left] duration-150 ease-out"
          style={{ left: `clamp(8px, calc(${left}% + 12px), calc(100% - 170px))` }}>
          <p className="text-[var(--ob-dim)]">Oct {sel + 1}, 2026</p>
          <p className="mt-1 flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-white" />{fmt(TOTAL[sel]!)} mentions</p>
          <p className="flex items-center gap-1.5 text-[#ff8a82]"><span className="size-1.5 rounded-full bg-[var(--ob-red)]" />{fmt(NEGATIVE[sel]!)} negative</p>
        </div>
      </div>
      {/* day chips (Vaulto) */}
      <div className="grid grid-cols-21 gap-1">
        {DAYS.map((d, i) => (
          <button key={d} onClick={() => setSel(i)} aria-label={`October ${d}`}
            className={`ob-pop mx-auto flex aspect-square w-full max-w-7 items-center justify-center rounded-full text-[10px] tabular-nums transition-colors ${i === sel ? "bg-white font-semibold text-black" : "border border-white/[0.07] text-[var(--ob-faint)] hover:text-white"}`}
            style={style({ "--d": `${900 + i * 25}ms` })}>{d}</button>
        ))}
      </div>
    </div>
  );
}

function Capsules() {
  const worst = WEEK.reduce((w, d, i) => (d.neg > WEEK[w]!.neg ? i : w), 0);
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? worst;
  return (
    <div className="ob-card ob-rise grid h-full content-start gap-4 p-5" style={style({ "--d": "500ms" })}>
      <CardHead title="Negative by weekday" icon={Bug} value={<><Count to={WEEK[shown]!.neg * 100} delay={500} />%</>} />
      <p className="-mt-2 text-[12px] text-[var(--ob-faint)]">{WEEK[shown]!.d}{shown === worst && hover === null ? " · worst day this month" : ""}</p>
      <div className="flex h-[218px] items-end justify-between gap-2">
        {WEEK.map((d, i) => (
          <button key={d.d} className="group grid h-full flex-1 grid-rows-[1fr_auto] justify-items-center gap-2" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} aria-label={`${d.d}: ${Math.round(d.neg * 100)}% negative`}>
            <span className="relative flex h-full w-full max-w-9 items-end overflow-hidden rounded-full bg-gradient-to-b from-white/[0.07] to-white/[0.02]">
              <span className="ob-grow-y w-full rounded-full" style={style({
                height: `${d.v * 100}%`, "--d": `${600 + i * 70}ms`,
                background: i === worst ? "linear-gradient(180deg, #ff6a60, var(--ob-red))" : "linear-gradient(180deg, rgba(255,255,255,0.42), rgba(255,255,255,0.12))",
                boxShadow: i === worst ? "0 0 28px rgba(255,59,47,0.55)" : undefined,
                opacity: hover === null || hover === i ? 1 : 0.45, transition: "opacity 160ms ease",
              })} />
            </span>
            <span className={`text-[12px] ${i === worst ? "font-medium text-white" : "text-[var(--ob-faint)]"}`}>{d.d}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function IssueDonut() {
  const r = 62, c = 2 * Math.PI * r, gap = 10;
  const starts = ISSUES.map((_, i) => ISSUES.slice(0, i).reduce((t, x) => t + (x.v / 100) * c, 0));
  const colors = ["var(--ob-red)", "rgba(255,255,255,0.85)", "rgba(255,255,255,0.5)", "rgba(255,255,255,0.22)"];
  return (
    <div className="ob-card ob-rise grid h-full content-start gap-4 p-5" style={style({ "--d": "580ms" })}>
      <CardHead title="Open issues by kind" icon={Inbox} />
      <div className="relative mx-auto size-[170px]">
        <svg viewBox="0 0 160 160" className="size-full -rotate-90" aria-label="Open issues by kind">
          {ISSUES.map((s, i) => (
            <circle key={s.name} cx="80" cy="80" r={r} fill="none" stroke={colors[i]} strokeWidth="16" strokeLinecap="round"
              strokeDasharray={`${(s.v / 100) * c - gap} ${c}`} strokeDashoffset={-starts[i]!}
              className="ob-fade" style={style({ "--d": `${700 + i * 120}ms`, filter: i === 0 ? "drop-shadow(0 0 8px rgba(255,59,47,0.6))" : undefined })} />
          ))}
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <Count to={14} delay={700} className="text-[30px] font-semibold leading-none tracking-[-0.03em]" />
          <span className="mt-1 text-[12px] text-[var(--ob-faint)]">open issues</span>
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
        {ISSUES.map((s, i) => (
          <li key={s.name} className="flex items-center gap-2">
            <span className="h-3 w-1 rounded-full" style={{ background: colors[i], boxShadow: i === 0 ? "var(--ob-glow)" : undefined }} />
            <span className="min-w-0 flex-1 truncate text-[var(--ob-dim)]">{s.name}</span>
            <span className="tabular-nums">{s.v}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Flow() {
  const W = 420, H = 230, NODE = 10, GAP = 10;
  const total = FLOW.from.reduce((t, n) => t + n.v, 0);
  const totalTo = FLOW.to.reduce((t, n) => t + n.v, 0);
  const scaleL = (H - GAP * (FLOW.from.length - 1)) / total;
  const scaleR = (H - GAP * (FLOW.to.length - 1)) / totalTo;
  const yL: Record<string, number> = {}, yR: Record<string, number> = {};
  let acc = 0; for (const n of FLOW.from) { yL[n.id] = acc; acc += n.v * scaleL + GAP; }
  acc = 0; for (const n of FLOW.to) { yR[n.id] = acc; acc += n.v * scaleR + GAP; }
  const outL = { ...yL }, inR = { ...yR };
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="ob-card ob-rise grid h-full content-start gap-4 p-5" style={style({ "--d": "660ms" })}>
      <CardHead title="From platforms to topics" icon={Sparkles} value={<Count to={10436} delay={660} />} />
      <div className="relative">
        <svg viewBox={`-90 0 ${W + 210} ${H}`} className="h-[230px] w-full" aria-label="Mentions flowing from platforms to topics">
          {FLOW.links.map(([a, b, v], i) => {
            const h1 = v * scaleL, h2 = v * scaleR;
            const y1 = outL[a]!, y2 = inR[b]!;
            outL[a]! += h1; inR[b]! += h2;
            const x0 = NODE, x1 = W - NODE, mx = W / 2;
            const d = `M${x0},${y1} C${mx},${y1} ${mx},${y2} ${x1},${y2} L${x1},${y2 + h2} C${mx},${y2 + h2} ${mx},${y1 + h1} ${x0},${y1 + h1} Z`;
            const hot = b === "bug";
            const dim = hover !== null && hover !== a && hover !== b;
            return <path key={i} d={d} fill={hot ? "url(#ob-flow-red)" : "rgba(255,255,255,0.09)"} className="ob-fade"
              style={style({ "--d": `${800 + i * 40}ms`, opacity: dim ? 0.25 : 1, transition: "opacity 180ms ease" })} />;
          })}
          <defs>
            <linearGradient id="ob-flow-red" x1="0" x2="1"><stop offset="0%" stopColor="#ff3b2f" stopOpacity="0.15" /><stop offset="100%" stopColor="#ff3b2f" stopOpacity="0.55" /></linearGradient>
          </defs>
          {FLOW.from.map((n) => (
            <g key={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} className="cursor-default">
              <rect x={0} y={yL[n.id]} width={NODE} height={n.v * scaleL} rx={3} fill="rgba(255,255,255,0.85)" />
              <text x={-8} y={yL[n.id]! + (n.v * scaleL) / 2} textAnchor="end" dominantBaseline="middle" className="fill-white text-[14px]">{n.name}</text>
              <text x={-8} y={yL[n.id]! + (n.v * scaleL) / 2 + 16} textAnchor="end" dominantBaseline="middle" className="fill-white/40 text-[12px]">{fmt(n.v)}</text>
            </g>
          ))}
          {FLOW.to.map((n) => (
            <g key={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} className="cursor-default">
              <rect x={W - NODE} y={yR[n.id]} width={NODE} height={n.v * scaleR} rx={3} fill={n.id === "bug" ? "var(--ob-red)" : "rgba(255,255,255,0.85)"}
                style={n.id === "bug" ? { filter: "drop-shadow(0 0 6px rgba(255,59,47,0.8))" } : undefined} />
              <text x={W + 8} y={yR[n.id]! + (n.v * scaleR) / 2} dominantBaseline="middle" className={n.id === "bug" ? "fill-[#ff8a82] text-[14px]" : "fill-white text-[14px]"}>{n.name}</text>
              <text x={W + 8} y={yR[n.id]! + (n.v * scaleR) / 2 + 16} dominantBaseline="middle" className="fill-white/40 text-[12px]">{fmt(n.v)}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function PixelHeat() {
  let peak: [number, number] = [0, 0];
  HEAT.forEach((row, d) => row.forEach((v, h) => { if (v > HEAT[peak[0]]![peak[1]]!) peak = [d, h]; }));
  const [cell, setCell] = useState<[number, number] | null>(null);
  const shown = cell ?? peak;
  const label = (h: number) => (h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`);
  return (
    <div className="ob-card ob-rise grid h-full content-start gap-4 p-5" style={style({ "--d": "740ms" })}>
      <CardHead title="When people talk" icon={Zap} value={<span className="text-[22px]">{WEEK[shown[0]]!.d} {label(shown[1])}</span>} />
      <p className="-mt-2 text-[12px] text-[var(--ob-faint)]">{cell ? `${Math.round(HEAT[shown[0]]![shown[1]]! * 100)} mentions` : "busiest hour this month"}</p>
      <div className="grid w-full max-w-[460px] gap-[3px]" onMouseLeave={() => setCell(null)}>
        {HEAT.map((row, d) => (
          <div key={d} className="grid grid-cols-24 gap-[3px]">
            {row.map((v, h) => {
              const hot = d === peak[0] && h === peak[1];
              return (
                <span key={h} onMouseEnter={() => setCell([d, h])} className="ob-pop aspect-square rounded-[2px]"
                  style={style({
                    "--d": `${850 + (d * 24 + h) * 3}ms`,
                    background: hot ? "var(--ob-red)" : `rgba(255,255,255,${v < 0.08 ? 0.04 : 0.08 + v * 0.82})`,
                    boxShadow: hot ? "0 0 12px rgba(255,59,47,0.9)" : cell && cell[0] === d && cell[1] === h ? "0 0 0 1px #fff" : undefined,
                  })} />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex w-full max-w-[460px] justify-between text-[11px] text-[var(--ob-faint)]"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div>
    </div>
  );
}

function Recent() {
  return (
    <div className="ob-card ob-rise grid h-full content-start gap-3 p-5" style={style({ "--d": "620ms" })}>
      <CardHead title="Latest mentions" icon={MessageSquare} action={<button className="ob-pill px-3 py-1 text-[12px] text-[var(--ob-dim)] hover:text-white">See all</button>} />
      <ul className="grid">
        {RECENT.map((m, i) => (
          <li key={m.who} className="ob-rise flex items-center gap-3 border-b border-white/[0.06] py-3 last:border-b-0" style={style({ "--d": `${760 + i * 80}ms` })}>
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${m.tone === "neg" ? "border-[var(--ob-red)]/40 bg-[var(--ob-red-soft)] text-[#ff8a82]" : "border-white/10 bg-white/[0.04] text-white"}`}>
              {m.src.slice(0, 1)}
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate text-[13px] text-white">{m.text}</span>
              <span className="truncate text-[11px] text-[var(--ob-faint)]">{m.who} · {m.src}</span>
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-[var(--ob-faint)]">{m.ago}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- page

export function Obsidian() {
  const [period, setPeriod] = useState("Month");
  const big = useCountUp(16957.42, 150);
  const [whole, frac] = fmt(big, 2).split(".");
  return (
    <div className="ob relative min-h-dvh overflow-x-hidden">
      <div className="ob-grain" aria-hidden />
      <div className="relative z-10 flex">
        {/* Sidebar (Vaulto) */}
        <aside className="sticky top-0 hidden h-dvh w-[220px] shrink-0 flex-col border-r border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-transparent px-3 py-5 md:flex">
          <div className="flex items-center gap-2.5 px-2">
            <span className="relative flex size-7 items-center justify-center">
              <span className="ob-breathe absolute inset-0 rounded-full bg-[var(--ob-red)] blur-md" />
              <svg viewBox="0 0 24 24" className="relative size-7" aria-hidden><circle cx="12" cy="12" r="11" fill="var(--ob-red)" /><path d="M6 13.5h3.2l1.6-4.5 2.2 7 1.5-4.2H18" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <span className="text-[17px] font-semibold tracking-[-0.02em]">SignalForge</span>
          </div>
          <button className="ob-pill mx-1 mt-6 flex items-center gap-2 px-3 py-2 text-left">
            <span className="flex size-6 items-center justify-center rounded-md bg-white text-[11px] font-bold text-black">G</span>
            <span className="grid min-w-0 flex-1 leading-tight"><span className="truncate text-[13px] font-medium">Gears of War: E-Day</span><span className="text-[11px] text-[var(--ob-faint)]">Product</span></span>
            <ChevronDown className="size-3.5 text-[var(--ob-faint)]" aria-hidden />
          </button>
          <nav className="mt-6 grid gap-5" aria-label="Main">
            {NAV.map((g) => (
              <div key={g.group} className="grid gap-1">
                <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ob-faint)]">{g.group}</p>
                {g.items.map(({ label, icon: Icon, active, count }) => (
                  <a key={label} href="#" aria-current={active ? "page" : undefined}
                    className={`relative flex h-9 items-center gap-3 rounded-xl px-3 text-[13px] transition-colors ${active ? "border border-white/10 bg-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "text-[var(--ob-dim)] hover:bg-white/[0.04] hover:text-white"}`}>
                    {active && <span className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-full bg-[var(--ob-red)] shadow-[var(--ob-glow)]" />}
                    <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                    <span className="flex-1">{label}</span>
                    {count !== undefined && <span className="rounded-md bg-white/[0.06] px-1.5 text-[11px] tabular-nums text-white/80">{count}</span>}
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <div className="ob-card mt-auto grid gap-2 p-4">
            <span className="flex items-center gap-2 text-[13px] font-medium"><Zap className="size-4 text-[var(--ob-red)]" aria-hidden />Upgrade to Pro</span>
            <span className="text-[12px] leading-snug text-[var(--ob-dim)]">Hourly checks on every platform and 15,000 mentions a month.</span>
          </div>
          <a href="#" className="mt-3 flex h-9 items-center gap-3 rounded-xl px-3 text-[13px] text-[var(--ob-dim)] hover:text-white"><Settings className="size-4" aria-hidden />Settings</a>
        </aside>

        <div className="min-w-0 flex-1">
          {/* Top bar */}
          <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-white/[0.05] bg-[#050506]/70 px-6 backdrop-blur-md">
            <nav className="min-w-0 truncate whitespace-nowrap text-[13px] text-[var(--ob-faint)]"><span className="hidden lg:inline">Gears of War: E-Day <span className="px-1">/</span> </span><span className="text-white">Overview</span></nav>
            <button className="ob-pill mx-auto hidden h-10 w-[420px] items-center gap-2.5 px-4 text-[13px] text-[var(--ob-faint)] transition-colors hover:text-white md:flex">
              <Search className="size-4" aria-hidden /><span className="flex-1 text-left">Search mentions or type a command</span>
              <span className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[11px]"><Command className="size-3" aria-hidden />K</span>
            </button>
            <div className="ml-auto flex items-center gap-2 md:ml-0">
              <span className="mr-1 hidden items-center gap-1.5 text-[12px] text-[var(--ob-dim)] sm:flex"><span className="ob-breathe size-1.5 rounded-full bg-emerald-400" />Live</span>
              <button className="ob-pill relative flex size-10 items-center justify-center text-[var(--ob-dim)] hover:text-white" aria-label="Notifications, 3 unread">
                <Bell className="size-4" aria-hidden /><span className="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-[var(--ob-red)] shadow-[var(--ob-glow)]" />
              </button>
              <span className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-white/90 to-white/50 text-[13px] font-semibold text-black">R</span>
            </div>
          </header>

          <main className="mx-auto grid max-w-[1400px] gap-5 px-6 pb-16 pt-8">
            {/* Hero (Loud) */}
            <section className="grid gap-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div className="ob-rise grid content-start gap-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <h1 className="text-[40px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[48px]">
                    Good evening, <span className="text-white/45">Raxit</span>
                  </h1>
                </div>
                <div className="grid gap-2">
                  <span className="text-[14px] text-[var(--ob-dim)]">Total mentions this month</span>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="text-[64px] font-semibold leading-none tracking-[-0.045em] tabular-nums">
                      {whole}<span className="text-white/30">.{frac}</span>
                    </span>
                    <span className="ob-pill flex items-center gap-1 px-2.5 py-1 text-[13px] text-emerald-400"><ArrowUpRight className="size-3.5" aria-hidden />+12.67%</span>
                  </div>
                  <span className="text-[14px] text-[var(--ob-dim)]">Positive <span className="text-white">41%</span> · Negative <span className="text-[#ff8a82]">16%</span> · 17 sources live</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="ob-red-btn flex h-11 items-center gap-2 px-5 text-[14px] font-medium"><Sparkles className="size-4" aria-hidden />Investigate top issue</button>
                  <button className="ob-pill flex h-11 items-center gap-2 px-5 text-[14px] text-white transition-colors hover:bg-white/[0.08]"><Download className="size-4" aria-hidden />Export</button>
                  <button className="ob-pill flex size-11 items-center justify-center text-[var(--ob-dim)] hover:text-white" aria-label="More actions"><MoreHorizontal className="size-4" aria-hidden /></button>
                </div>
              </div>
              <div className="ob-rise grid gap-5" style={style({ "--d": "120ms" })}>
                <div className="flex justify-end"><Segmented options={["Week", "Month", "Year"]} value={period} onChange={setPeriod} /></div>
                <MixBar />
              </div>
            </section>

            {/* Source cards (Vaulto currency cards) */}
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Top platforms">
              {SOURCES.map((s, i) => <SourceCard key={s.name} s={s} i={i} />)}
              <button className="ob-rise grid place-content-center gap-2 rounded-[18px] border border-dashed border-white/15 p-4 text-center text-[13px] text-[var(--ob-dim)] transition-colors hover:border-white/30 hover:text-white sm:col-span-2 xl:col-span-1" style={style({ "--d": "460ms" })}>
                <span className="mx-auto flex size-9 items-center justify-center rounded-full border border-white/15"><Plus className="size-4" aria-hidden /></span>
                Add another platform<br /><span className="text-[11px] text-[var(--ob-faint)]">or a competitor to compare</span>
              </button>
            </section>

            {/* Charts */}
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-12">
              <div className="sm:col-span-2 xl:col-span-6"><MainChart /></div>
              <div className="xl:col-span-3"><Capsules /></div>
              <div className="xl:col-span-3"><IssueDonut /></div>
            </section>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-12">
              <div className="sm:col-span-2 xl:col-span-4"><Recent /></div>
              <div className="xl:col-span-5"><Flow /></div>
              <div className="xl:col-span-3"><PixelHeat /></div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
