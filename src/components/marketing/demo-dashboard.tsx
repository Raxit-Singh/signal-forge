"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  BarChart3, Bell, Bot, Calendar, ChevronDown, FileText, Gauge, LayoutGrid, Lightbulb, MessageSquareText, Search, Settings, Swords, Waves,
} from "lucide-react";
import { HeardexMark } from "@/components/brand";
import { PlatformMark } from "@/components/brand-logo";
import "./demo-dashboard.css";

/**
 * A Heardex screen drawn in code for the product pages, with sample data about a made-up notes app ("Acme Notes",
 * competitor "Rival Notes"). It is laid out at a fixed desktop width and scaled to fit, so it stays sharp at any size,
 * and it assembles itself (sidebar, numbers, cards, charts) when it scrolls into view.
 */
export type DemoKind = "mentions" | "monitoring" | "competitors" | "trends" | "claude";

const W = 1280;
const PRODUCT = "Acme Notes";

const NAV: { group: string; items: { label: string; icon: typeof LayoutGrid; kind?: DemoKind }[] }[] = [
  { group: "General", items: [{ label: "Overview", icon: LayoutGrid }, { label: "Mentions", icon: MessageSquareText, kind: "mentions" }, { label: "Issues", icon: BarChart3 }] },
  { group: "Insights", items: [{ label: "Trends", icon: Waves, kind: "trends" }, { label: "Competitors", icon: Swords, kind: "competitors" }, { label: "Insights", icon: Lightbulb }] },
  { group: "Other", items: [{ label: "Monitoring", icon: Gauge, kind: "monitoring" }, { label: "Reports", icon: FileText }] },
];
const TITLE: Record<DemoKind, string> = { mentions: "Mentions", monitoring: "Monitoring", competitors: "Competitors", trends: "Trends", claude: "Settings" };

/** Stagger helper: the order an element appears in, as a CSS delay. */
const d = (i: number) => ({ ["--dd" as string]: `${i * 70}ms` });

export function DemoDashboard({ kind, className }: { kind: DemoKind; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setK(el.clientWidth / W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const h = kind === "claude" ? 700 : 780;

  return (
    <figure className={`hx-shot hx-rise is-wide not-prose ${className ?? ""}`}>
      <div className="hx-shot-frame">
        <div className="hx-shot-bar" aria-hidden><span /><span /><span /><span className="ml-auto text-[11px] text-[#6b6b72]">heardex.com</span></div>
        <div ref={box} className="dd-box" style={{ aspectRatio: `${W} / ${h}` }} role="img"
          aria-label={`Sample ${TITLE[kind]} screen in Heardex for a made-up notes app`}>
          <div className="dd" style={{ width: W, height: h, transform: `scale(${k})`, visibility: k ? "visible" : "hidden" }} aria-hidden>
            <Sidebar kind={kind} />
            <div className="dd-main">
              <Topbar title={TITLE[kind]} />
              <div className="dd-page">
                {kind === "mentions" && <MentionsScreen />}
                {kind === "monitoring" && <MonitoringScreen />}
                {kind === "competitors" && <CompetitorsScreen />}
                {kind === "trends" && <TrendsScreen />}
                {kind === "claude" && <ClaudeScreen />}
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-4 text-[13px] text-[var(--muted)]">Heardex with sample data about a made-up notes app.</figcaption>
    </figure>
  );
}

function Sidebar({ kind }: { kind: DemoKind }) {
  return (
    <aside className="dd-side dd-in-side">
      <div className="flex items-center gap-2.5 px-2 pt-1 text-[19px] font-semibold tracking-[-0.03em]">
        <span className="relative grid size-7 place-items-center"><span className="dd-glow" /><HeardexMark className="relative h-6 w-6" /></span>heardex
      </div>
      <div className="dd-card mt-6 flex items-center gap-3 px-3 py-2.5">
        <span className="grid size-7 place-items-center rounded-md bg-white text-[13px] font-semibold text-black">A</span>
        <span className="grid leading-tight"><span className="text-[14px]">{PRODUCT}</span><span className="text-[11px] text-[#7d7d85]">Product</span></span>
        <ChevronDown className="ml-auto size-4 text-[#7d7d85]" />
      </div>
      {NAV.map((g) => (
        <div key={g.group} className="mt-6">
          <p className="px-3 text-[10px] font-medium tracking-[0.14em] text-[#6b6b72] uppercase">{g.group}</p>
          <ul className="mt-2 grid gap-0.5">
            {g.items.map((it) => {
              const on = it.kind === kind;
              return (
                <li key={it.label} className={`dd-nav${on ? " is-on" : ""}`}>
                  <it.icon className="size-[17px]" strokeWidth={1.6} />{it.label}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="dd-card mt-auto px-3.5 py-3">
        <p className="flex justify-between text-[13px]"><span>Pro plan</span><span className="text-[#7d7d85]">38%</span></p>
        <div className="mt-2 h-1.5 rounded-full bg-[#26262b]"><div className="dd-grow h-full rounded-full bg-[var(--dd-red)]" style={{ width: "38%" }} /></div>
        <p className="mt-2 text-[11px] text-[#7d7d85]">3,840 of 10,000 mentions this period</p>
      </div>
      <p className={`dd-nav mt-3${kind === "claude" ? " is-on" : ""}`}><Settings className="size-[17px]" strokeWidth={1.6} />Settings</p>
    </aside>
  );
}

function Topbar({ title }: { title: string }) {
  return (
    <header className="dd-top dd-in-top">
      <p className="text-[13px] text-[#8f8f96]">{PRODUCT} <span className="mx-1.5 text-[#55555c]">/</span><span className="text-[#f4f4f5]">{title}</span></p>
      <div className="dd-pill mx-auto flex w-[380px] items-center gap-2 px-3.5 py-2 text-[13px] text-[#6b6b72]"><Search className="size-4" />Search mentions, issues or jump to…<span className="ml-auto rounded border border-[#2a2a30] px-1.5 text-[10px]">⌘K</span></div>
      <span className="flex items-center gap-1.5 text-[12px] text-[#8f8f96]"><i className="dd-live" />Live</span>
      <span className="dd-pill flex items-center gap-2 px-3.5 py-2 text-[13px]"><Calendar className="size-4" />Last 30 days</span>
      <Bell className="size-[18px] text-[#b4b4ba]" />
      <span className="grid size-8 place-items-center rounded-full bg-[#1f1f23] text-[12px] font-semibold">A</span>
    </header>
  );
}

function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="dd-in" style={d(1)}>
      <h3 className="text-[44px] font-semibold leading-none tracking-[-0.035em]">{title}</h3>
      <p className="mt-3 text-[14px] text-[#8f8f96]">{sub}</p>
    </div>
  );
}

const DAILY = [22, 30, 26, 41, 38, 35, 52, 47, 44, 61, 58, 66, 49, 72, 120, 168, 141, 96, 80, 74, 69, 77, 84, 79, 91, 88, 102, 97, 110, 104];

function MentionsScreen() {
  const max = Math.max(...DAILY);
  const platforms = [["all", "All platforms", "2,418", 100], ["reddit", "Reddit", "812", 34], ["hackernews", "Hacker News", "406", 17], ["app_store", "App Store", "351", 15], ["github", "GitHub", "298", 12], ["youtube", "YouTube", "221", 9]] as const;
  return (
    <>
      <div className="grid grid-cols-[1fr_1.1fr] gap-10">
        <div>
          <Head title="Mentions" sub={`Conversations matching the keywords for ${PRODUCT} · last 30 days`} />
          <p className="dd-in mt-7 text-[76px] font-semibold leading-none tracking-[-0.045em]" style={d(2)}>2,418</p>
          <p className="dd-in mt-4 text-[14px] text-[#8f8f96]" style={d(3)}>Negative <span className="text-[var(--dd-red)]">18%</span> · Positive <span className="text-[#f4f4f5]">41%</span> · 64 in the last 24 hours</p>
          <div className="dd-in mt-6 flex gap-2.5" style={d(4)}>
            <span className="dd-btn">Review 37 matches</span><span className="dd-pill px-4 py-2.5 text-[14px]">Trends</span>
          </div>
        </div>
        <div className="flex h-[230px] items-end gap-[5px] self-end">
          {DAILY.map((v, i) => (
            <span key={i} className="dd-bar flex-1 rounded-full" style={{ height: `${Math.max(6, (v / max) * 100)}%`, ["--dd" as string]: `${300 + i * 22}ms` }} />
          ))}
        </div>
      </div>
      <div className="mt-8 grid grid-cols-6 gap-3">
        {platforms.map(([src, name, n, pct], i) => (
          <div key={src} className={`dd-card dd-in px-4 py-3.5${i === 0 ? " is-sel" : ""}`} style={d(5 + i)}>
            <p className="flex items-center gap-2 text-[13px] text-[#b4b4ba]">{src === "all" ? <span className="grid size-6 place-items-center rounded-full bg-white text-[11px] text-black">✱</span> : <PlatformMark source={src} size={24} />}{name}</p>
            <p className="mt-3 flex items-baseline justify-between"><span className="text-[22px] font-semibold tracking-[-0.02em]">{n}</span><span className="text-[11px] text-[#7d7d85]">{pct}%</span></p>
            <div className="mt-2.5 h-1 rounded-full bg-[#26262b]"><div className="dd-grow h-full rounded-full bg-[#e8e8ea]" style={{ width: `${pct}%` }} /></div>
          </div>
        ))}
      </div>
      <div className="dd-in mt-6 flex items-center gap-2 text-[13px]" style={d(11)}>
        {["All 2,418", "Need review 37", "Negative 435", "Positive 991"].map((t, i) => <span key={t} className={`rounded-full px-3.5 py-1.5 ${i === 0 ? "bg-[#1f1f23]" : "text-[#8f8f96]"}`}>{t}</span>)}
      </div>
      <div className="mt-4 grid gap-3">
        <Mention i={12} src="reddit" who="u/maya_sample" where="r/productivity" when="2 hours ago" tag="Bug" tone="neg" text="Export to PDF crashes every time my note is longer than 40 pages. Third time this week." />
        <Mention i={13} src="app_store" who="App Store · ★★★★★" where="Review" when="5 hours ago" tag="Testimonial" tone="pos" text="Search is instant. Found a note from three years ago in a second." />
      </div>
    </>
  );
}

function Mention({ i, src, who, where, when, tag, tone, text }: { i: number; src: string; who: string; where: string; when: string; tag: string; tone: "neg" | "pos"; text: string }) {
  return (
    <div className="dd-card dd-in flex gap-4 px-5 py-4" style={d(i)}>
      <PlatformMark source={src} size={36} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px]"><span className="font-medium">{who}</span> <span className="text-[#7d7d85]">· {where} · {when}</span></p>
        <p className="mt-1.5 text-[16px]">{text}</p>
      </div>
      <span className={`h-fit rounded-full px-2.5 py-1 text-[11px] ${tone === "neg" ? "bg-[#ff3b2f1f] text-[#ff8a80]" : "bg-[#2fb56b1f] text-[#6fd69c]"}`}>{tag}</span>
    </div>
  );
}

function MonitoringScreen() {
  const keywords = [["Acme Notes", "Brand", 1402, [58, 17, 13, 7, 5]], ["acme app", "", 611, [44, 22, 18, 9, 7]], ["acmenotes.example", "Website", 405, [36, 30, 16, 12, 6]]] as const;
  const colors = ["#8b7cf6", "#2fb56b", "#f59e0b", "#ef4444", "#38bdf8"];
  const sources = [["reddit", "Reddit", "812 · 34%"], ["hackernews", "Hacker News", "406 · 17%"], ["app_store", "App Store", "351 · 15%"], ["github", "GitHub", "298 · 12%"], ["youtube", "YouTube", "221 · 9%"], ["bluesky", "Bluesky", "174 · 7%"]] as const;
  return (
    <>
      <div className="grid grid-cols-[1fr_1fr] gap-8">
        <div>
          <Head title="Monitoring" sub="Every keyword is searched on every platform that supports it. Busier searches are checked more often." />
          <p className="dd-in mt-6 text-[13px] text-[#8f8f96]" style={d(2)}>Total mentions · last 30 days</p>
          <p className="dd-in mt-2 text-[72px] font-semibold leading-none tracking-[-0.045em]" style={d(2)}>2,418</p>
          <div className="dd-in mt-6 flex gap-2.5" style={d(3)}><span className="dd-pill flex items-center gap-2 px-4 py-2 text-[13px]"><i className="dd-live" />Scanning live</span></div>
        </div>
        <div className="grid grid-cols-2 gap-3 self-end">
          {[["Active platforms", "15", "Searched for this product"], ["Keywords monitored", "3", "All active"], ["Last scan", "6 minutes ago", "Every platform answered"], ["Next scan", "in 54 minutes", "Reddit and Hacker News"]].map(([a, b, c], i) => (
            <div key={a} className="dd-card dd-in px-4 py-3.5" style={d(3 + i)}>
              <p className="text-[12px] text-[#8f8f96]">{a}</p><p className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em]">{b}</p><p className="mt-1 text-[12px] text-[#7d7d85]">{c}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-7 grid grid-cols-[1.45fr_1fr] gap-4">
        <div className="dd-card dd-in p-5" style={d(8)}>
          <p className="text-[14px]">Keyword performance</p>
          <p className="mt-1 text-[12px] text-[#7d7d85]">Relevant mentions per keyword, last 30 days, and the platforms they come from.</p>
          <div className="mt-4 grid gap-4">
            {keywords.map(([term, kindLabel, n, mix], i) => (
              <div key={term}>
                <p className="flex items-center gap-2 text-[14px]"><span className="text-[#7d7d85]">{i + 1}</span>{term}{kindLabel && <span className="rounded bg-[#1f1f23] px-1.5 py-0.5 text-[10px] text-[#8f8f96]">{kindLabel}</span>}<span className="ml-auto">{n.toLocaleString("en-US")} mentions</span></p>
                <div className="dd-grow mt-2 flex h-2 gap-[3px]" style={{ width: `${(n / 1402) * 100}%`, ["--dd" as string]: `${700 + i * 120}ms` }}>
                  {mix.map((m, j) => <span key={j} className="h-full rounded-full" style={{ width: `${m}%`, background: colors[j] }} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="dd-card dd-in flex gap-6 p-5" style={d(9)}>
          <div className="relative grid size-[150px] flex-none place-items-center">
            <svg viewBox="0 0 36 36" className="dd-donut absolute inset-0">
              {([[34, 0], [17, 34], [15, 51], [12, 66], [9, 78], [7, 87]] as const).map(([v, off], i) => (
                <circle key={i} cx="18" cy="18" r="15.5" fill="none" stroke={["#ff4500", "#ff6600", "#0a84ff", "#e8e8ea", "#ff0033", "#1185fe"][i]} strokeWidth="3.2"
                  pathLength={100} strokeDasharray={`${v - 0.8} ${100 - v + 0.8}`} strokeDashoffset={-off} />
              ))}
            </svg>
            <p className="text-center leading-tight"><span className="block text-[26px] font-semibold">2,418</span><span className="text-[11px] text-[#7d7d85]">mentions</span></p>
          </div>
          <ul className="grid flex-1 content-center gap-2 text-[13px]">
            {sources.map(([s, name, v]) => <li key={s} className="flex items-center gap-2"><PlatformMark source={s} size={20} />{name}<span className="ml-auto text-[#8f8f96]">{v}</span></li>)}
          </ul>
        </div>
      </div>
      <div className="dd-card dd-in mt-4 p-5" style={d(10)}>
        <p className="text-[14px]">Scan schedule</p>
        <p className="mt-1 text-[12px] text-[#7d7d85]">When each platform is checked next, over the coming 24 hours. Busier platforms are checked more often.</p>
        <div className="mt-4 grid gap-3">
          {([["reddit", "Reddit", 4, "every 1 h"], ["hackernews", "Hacker News", 4, "every 1 h"], ["app_store", "App Store", 25, "every 6 h"], ["github", "GitHub", 50, "every 12 h"]] as const).map(([s, name, at, every], i) => (
            <div key={s} className="grid grid-cols-[150px_1fr_90px] items-center gap-4 text-[13px]">
              <span className="flex items-center gap-2"><PlatformMark source={s} size={20} />{name}</span>
              <div className="relative h-1.5 rounded-full bg-[#1f1f23]">
                <span className="dd-grow absolute inset-y-0 left-0 rounded-full bg-[#2a2a30]" style={{ width: `${at}%`, ["--dd" as string]: `${900 + i * 90}ms` }} />
                <i className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-[#08080a] bg-[#e8e8ea]" style={{ left: `calc(${at}% - 6px)` }} />
              </div>
              <span className="text-right text-[#8f8f96]">{every}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const SERIES = {
  acme: [40, 44, 41, 52, 49, 55, 61, 58, 63, 70, 66, 74, 71, 79, 92, 118, 104, 88, 84, 86, 90, 95, 92, 99, 104, 101, 110, 114, 109, 118],
  rival: [52, 50, 55, 49, 53, 51, 48, 54, 50, 47, 52, 49, 46, 50, 48, 45, 49, 51, 47, 44, 46, 49, 45, 43, 47, 44, 42, 46, 43, 41],
};
const path = (vals: number[], w: number, h: number, max: number) =>
  vals.map((v, i) => `${i ? "L" : "M"}${((i / (vals.length - 1)) * w).toFixed(1)} ${(h - (v / max) * h).toFixed(1)}`).join(" ");

function CompetitorsScreen() {
  return (
    <>
      <div className="grid grid-cols-[1fr_1.1fr] gap-8">
        <div>
          <Head title="Competitors" sub={`${PRODUCT} compared with the competitors you choose · last 30 days`} />
          <p className="dd-in mt-7 text-[13px] text-[#8f8f96]" style={d(2)}>Share of voice</p>
          <div className="dd-in mt-3 flex h-4 overflow-hidden rounded-full" style={d(3)}>
            {[[46, "#ff3b2f"], [31, "#8b7cf6"], [23, "#38bdf8"]].map(([v, c]) => <span key={c} className="dd-grow h-full first:rounded-l-full" style={{ width: `${v}%`, background: c as string }} />)}
          </div>
          <ul className="dd-in mt-4 grid gap-2.5 text-[15px]" style={d(4)}>
            {[["Acme Notes (you)", "46%", "#ff3b2f", "+6 pts"], ["Rival Notes", "31%", "#8b7cf6", "−4 pts"], ["Sample Docs", "23%", "#38bdf8", "−2 pts"]].map(([n, v, c, ch]) => (
              <li key={n} className="flex items-center gap-2.5"><i className="size-2.5 rounded-full" style={{ background: c }} />{n}<span className="ml-auto font-semibold">{v}</span><span className="w-16 text-right text-[12px] text-[#8f8f96]">{ch}</span></li>
            ))}
          </ul>
        </div>
        <div className="dd-card dd-in self-end p-5" style={d(3)}>
          <p className="text-[14px]">Mentions per day</p>
          <svg viewBox="0 0 520 190" className="mt-4 w-full overflow-visible">
            {[0, 1, 2, 3].map((g) => <line key={g} x1="0" x2="520" y1={g * 60 + 10} y2={g * 60 + 10} stroke="#1f1f23" />)}
            <path d={path(SERIES.rival, 520, 180, 125)} className="dd-line" pathLength={1} stroke="#8b7cf6" transform="translate(0 10)" />
            <path d={path(SERIES.acme, 520, 180, 125)} className="dd-line" pathLength={1} stroke="#ff3b2f" style={{ ["--dd" as string]: "450ms" }} transform="translate(0 10)" />
          </svg>
        </div>
      </div>
      <div className="mt-7 grid grid-cols-3 gap-3">
        {[["Acme Notes", 41, 18], ["Rival Notes", 29, 31], ["Sample Docs", 35, 22]].map(([n, pos, neg], i) => (
          <div key={n} className="dd-card dd-in p-5" style={d(6 + i)}>
            <p className="text-[14px]">{n} <span className="text-[12px] text-[#7d7d85]">· sentiment</span></p>
            <div className="mt-3 flex h-2.5 gap-[3px]">
              <span className="dd-grow rounded-full bg-[#2fb56b]" style={{ width: `${pos}%` }} />
              <span className="dd-grow rounded-full bg-[#3a3a40]" style={{ width: `${100 - (pos as number) - (neg as number)}%` }} />
              <span className="dd-grow rounded-full bg-[#ff3b2f]" style={{ width: `${neg}%` }} />
            </div>
            <p className="mt-2.5 flex justify-between text-[12px] text-[#8f8f96]"><span>Positive {pos}%</span><span>Negative {neg}%</span></p>
          </div>
        ))}
      </div>
      <div className="dd-card dd-in mt-4 flex items-center gap-4 px-5 py-4 text-[14px]" style={d(9)}>
        <Lightbulb className="size-5 text-[#f59e0b]" />Rival Notes mentions fell 12% after their price change. 9 people said they switched to Acme Notes.
      </div>
      <div className="dd-card dd-in mt-4 p-5" style={d(10)}>
        <p className="text-[14px]">What people compare</p>
        <p className="mt-1 text-[12px] text-[#7d7d85]">Topics that come up in posts mentioning both products, and who comes out ahead.</p>
        <div className="mt-4 grid gap-3">
          {([["Search speed", 72, "Acme Notes ahead"], ["Sync reliability", 38, "Rival Notes ahead"], ["Price", 51, "Even"], ["Templates", 64, "Acme Notes ahead"]] as const).map(([topic, share, verdict], i) => (
            <div key={topic} className="grid grid-cols-[150px_1fr_150px] items-center gap-4 text-[13px]">
              <span>{topic}</span>
              <div className="flex h-2 gap-[3px]">
                <span className="dd-grow rounded-full bg-[#ff3b2f]" style={{ width: `${share}%`, ["--dd" as string]: `${900 + i * 90}ms` }} />
                <span className="dd-grow rounded-full bg-[#8b7cf6]" style={{ width: `${100 - share}%`, ["--dd" as string]: `${900 + i * 90}ms` }} />
              </div>
              <span className="text-right text-[#8f8f96]">{verdict}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function TrendsScreen() {
  const vals = SERIES.acme;
  const line = path(vals, 1100, 250, 125);
  return (
    <>
      <div className="grid grid-cols-[1fr_1fr] gap-8">
        <div>
          <Head title="Trends" sub={`How much attention ${PRODUCT} gets and whether it's rising`} />
          <p className="dd-in mt-6 text-[13px] text-[#8f8f96]" style={d(2)}>Mentions · last 30 days</p>
          <p className="dd-in mt-2 text-[72px] font-semibold leading-none tracking-[-0.045em]" style={d(2)}>2,418</p>
          <div className="dd-in mt-6 flex gap-10" style={d(3)}>
            {[["Unique authors", "1,906"], ["Engagement", "48.2K"], ["Needs review", "37"]].map(([a, b]) => <p key={a}><span className="block text-[12px] text-[#8f8f96]">{a}</span><span className="text-[22px] font-semibold">{b}</span></p>)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 self-end">
          {([["Today", "87", "Yesterday: 104"], ["Last 24 h vs previous 24 h", "−16%", "Was 104"], ["Last 7 days vs previous 7", "+18%", "Was 612"], ["Last 30 days vs previous 30", "+31%", "Was 1,846"]] as const).map(([a, b, c], i) => (
            <div key={a} className="dd-card dd-in px-4 py-3.5" style={d(3 + i)}>
              <p className="text-[12px] text-[#8f8f96]">{a}</p><p className={`mt-1.5 text-[24px] font-semibold ${b.startsWith("+") ? "text-[#6fd69c]" : ""}`}>{b}</p><p className="mt-1 text-[12px] text-[#7d7d85]">{c}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="dd-card dd-in mt-7 p-6" style={d(8)}>
        <p className="text-[20px] font-semibold tracking-[-0.02em]">Mentions over time</p>
        <p className="mt-1 text-[12px] text-[#7d7d85]">Daily, by publication time. The spike on day 16 is the 2.0 launch.</p>
        <svg viewBox="0 0 1100 270" className="mt-5 w-full overflow-visible">
          <defs><linearGradient id="dd-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#ff3b2f" stopOpacity="0.28" /><stop offset="1" stopColor="#ff3b2f" stopOpacity="0" /></linearGradient></defs>
          {[0, 1, 2, 3, 4].map((g) => <line key={g} x1="0" x2="1100" y1={g * 62.5 + 10} y2={g * 62.5 + 10} stroke="#1f1f23" />)}
          <path d={`${line} L1100 250 L0 250 Z`} fill="url(#dd-area)" className="dd-area" transform="translate(0 10)" />
          <path d={line} className="dd-line" pathLength={1} stroke="#ff3b2f" strokeWidth="2.5" style={{ ["--dd" as string]: "650ms" }} transform="translate(0 10)" />
          <circle cx={(15 / 29) * 1100} cy={260 - (118 / 125) * 250} r="5" fill="#ff3b2f" className="dd-pop" />
        </svg>
      </div>
    </>
  );
}

function ClaudeScreen() {
  return (
    <div className="grid grid-cols-[230px_1fr] gap-8">
      <div>
        <Head title="Settings" sub="Workspace, products and connections." />
        <ul className="dd-in mt-8 grid gap-1 text-[14px]" style={d(2)}>
          {["Workspace", "Products", "Connections", "Heardex Intelligence", "Heardex MCP", "Plan & billing", "Account"].map((s) => (
            <li key={s} className={`dd-nav${s === "Heardex MCP" ? " is-on" : ""}`}>{s === "Heardex MCP" && <Bot className="size-4" />}{s}</li>
          ))}
        </ul>
      </div>
      <div className="grid content-start gap-4 pt-2">
        <div className="dd-card dd-in p-6" style={d(3)}>
          <p className="flex items-center gap-3 text-[20px] font-semibold tracking-[-0.02em]">Heardex MCP <span className="flex items-center gap-1.5 rounded-full bg-[#2fb56b1f] px-2.5 py-1 text-[11px] font-normal text-[#6fd69c]"><i className="size-1.5 rounded-full bg-[#2fb56b]" />Connected</span></p>
          <p className="mt-2 max-w-[640px] text-[14px] text-[#8f8f96]">Your AI assistant can read the feedback and issues for {PRODUCT}, and investigate bugs in your code. Read-only: it can&apos;t change anything in Heardex.</p>
        </div>
        <div className="dd-card dd-in p-6" style={d(5)}>
          <p className="ml-auto w-fit max-w-[70%] rounded-2xl rounded-br-md bg-[#1f1f23] px-4 py-3 text-[15px]">What are the top complaints about Acme Notes this week?</p>
          <div className="dd-in mt-4 flex gap-3" style={d(7)}>
            <span className="grid size-8 flex-none place-items-center rounded-full bg-[#ff3b2f1f]"><HeardexMark className="h-4 w-4 text-[#ff8a80]" /></span>
            <div className="text-[15px] leading-relaxed">
              <p>Three issues stand out this week, from 112 reports:</p>
              <ol className="mt-2 grid gap-1.5">
                {[["PDF export crashes on long notes", "39 reports · Reddit, App Store, GitHub"], ["Sync stalls at 99% after 1.8", "27 reports · GitHub, Hacker News"], ["Price increase without notice", "18 reports · App Store, Reddit"]].map(([t, m], i) => (
                  <li key={t} className="dd-in" style={d(8 + i)}><span className="text-[#ff8a80]">{i + 1}.</span> {t} <span className="text-[13px] text-[#7d7d85]">· {m}</span></li>
                ))}
              </ol>
              <p className="mt-3 text-[#8f8f96]">Want me to look for the cause of the PDF crash in your code?</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
