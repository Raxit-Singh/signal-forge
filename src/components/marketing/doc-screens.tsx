"use client";

import {
  ArrowDownRight, ArrowUpRight, Bot, Building2, Check, ChevronDown, ChevronLeft, CreditCard, Download, Inbox, MessageSquareText, Package, Plug2, Plus,
  Search, Sparkles, Square, Swords, Trash2, TrendingUp, UserRound,
} from "lucide-react";
import { PlatformMark } from "@/components/brand-logo";
import { Sidebar, Topbar } from "./demo-dashboard";
import "./demo-dashboard.css";

/**
 * The Docs screenshots, drawn in code with sample data about a made-up notes app. Each copies the layout of the
 * real screen it stands for, at the size of the original picture (1440 px wide), and marks the parts the Docs
 * point at with data-spot so their positions can be measured. Rendered to images by scripts/docs-shots.mjs.
 */
export const DOC_SHOTS = {
  overview: { w: 1440, h: 950 },
  mentions: { w: 1440, h: 830 },
  trends: { w: 1440, h: 950 },
  competitors: { w: 1440, h: 800 },
  monitoring: { w: 1440, h: 950 },
  claude: { w: 1440, h: 700 },
  keywords: { w: 912, h: 410 },
} as const;
export type DocShot = keyof typeof DOC_SHOTS;

const P = "Acme Notes";
const muted = "text-[#8f8f96]";
const faint = "text-[#7d7d85]";

export function DocScreen({ shot }: { shot: DocShot }) {
  const { w, h } = DOC_SHOTS[shot];
  if (shot === "keywords") return <div className="dd block" style={{ width: w, height: h, position: "relative" }}><Keywords /></div>;
  const nav = shot === "claude" ? "claude" : shot;
  return (
    <div className="dd" style={{ width: w, height: h, position: "relative" }}>
      <Sidebar kind={nav} owner={h >= 900} />
      <div className="dd-main">
        <Topbar title={{ overview: "Overview", mentions: "Mentions", trends: "Trends", competitors: "Competitors", monitoring: "Monitoring", claude: "Settings" }[shot]} />
        <div className="dd-page">
          {shot === "overview" && <Overview />}
          {shot === "mentions" && <Mentions />}
          {shot === "trends" && <Trends />}
          {shot === "competitors" && <Competitors />}
          {shot === "monitoring" && <Monitoring />}
          {shot === "claude" && <Claude />}
        </div>
      </div>
    </div>
  );
}

function Title({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div>
      <h3 className="text-[46px] font-semibold leading-none tracking-[-0.035em]">{children}</h3>
      {sub && <p className={`mt-3 text-[14px] ${muted}`}>{sub}</p>}
    </div>
  );
}
const Periods = () => (
  <div className="dd-pill flex gap-1 p-1 text-[14px]">{["Week", "Month", "Quarter"].map((p) => <span key={p} className={`rounded-full px-4 py-1.5 ${p === "Month" ? "bg-[#1f1f23]" : muted}`}>{p}</span>)}</div>
);
const Big = ({ children }: { children: React.ReactNode }) => <p className="text-[72px] font-semibold leading-none tracking-[-0.045em]">{children}</p>;
const Spark = ({ pts, color = "#e8e8ea" }: { pts: number[]; color?: string }) => {
  const max = Math.max(...pts);
  return (
    <svg viewBox="0 0 100 30" className="h-8 w-[100px]"><path fill="none" stroke={color} strokeWidth="1.4"
      d={pts.map((v, i) => `${i ? "L" : "M"}${(i / (pts.length - 1)) * 100} ${30 - (v / max) * 28}`).join(" ")} /></svg>
  );
};
const DAYS = [40, 44, 41, 52, 49, 55, 61, 58, 63, 70, 66, 74, 71, 79, 92, 118, 104, 88, 84, 86, 90, 95, 92, 99, 104, 101, 110, 114, 109, 118];
const line = (vals: number[], w: number, h: number, max: number) =>
  vals.map((v, i) => `${i ? "L" : "M"}${((i / (vals.length - 1)) * w).toFixed(1)} ${(h - (v / max) * h).toFixed(1)}`).join(" ");

function Overview() {
  const cards = [["reddit", "Reddit", "812", [3, 4, 3, 6, 5, 7, 9, 8, 12, 9, 11, 10]], ["hackernews", "Hacker News", "406", [2, 3, 2, 2, 8, 4, 3, 5, 4, 6, 5, 7]], ["app_store", "App Store", "351", [4, 4, 5, 4, 6, 5, 6, 7, 6, 7, 8, 8]], ["github", "GitHub", "298", [1, 2, 1, 3, 2, 6, 3, 2, 4, 3, 5, 4]]] as const;
  return (
    <>
      <div className="flex items-start justify-between"><Title>Good evening</Title><Periods /></div>
      <div className="mt-8 grid grid-cols-[1fr_1.15fr] gap-12">
        <div>
          <p className={`text-[15px] ${muted}`}>{P} · mentions, last 30 days</p>
          <div className="mt-5"><Big>2,418</Big></div>
          <p className={`mt-6 text-[14px] ${muted}`}>15 sources live</p>
          <div className="mt-6 flex gap-2.5">
            <span className="dd-btn flex items-center gap-2"><MessageSquareText className="size-4" />Read mentions</span>
            <span className="dd-pill flex items-center gap-2 px-5 py-2.5 text-[14px]"><Download className="size-4" />Reports</span>
          </div>
        </div>
        <div className="pt-3">
          <p className={`flex justify-between text-[13px] ${muted}`}><span>Where the conversation is</span><span>≈ 81 a day</span></p>
          <div className="mt-6 flex h-[86px] gap-2">
            {[[34, "Reddit", "#ff3b2f"], [17, "Hacker News", "#ff7a4d"], [15, "App Store", "#ffa07a"], [12, "GitHub", "#c9c9cf"], [22, "Others", "#3a3a40"]].map(([v, n, c]) => (
              <div key={n as string} style={{ width: `${v}%` }}>
                <p className="mb-2 truncate text-[12px]"><b>{v}%</b> <span className={muted}>{n}</span></p>
                <div className="h-[60px] rounded-xl" style={{ background: c as string, boxShadow: v === 34 ? "0 10px 30px -10px rgb(255 59 47 / .7)" : undefined }} />
              </div>
            ))}
          </div>
          <p className={`mt-3 flex justify-between text-[12px] ${faint}`}><span>October 24</span><span>November 22</span></p>
        </div>
      </div>
      <div data-spot="platforms" className="mt-7 grid grid-cols-5 gap-3">
        {cards.map(([src, name, n, pts]) => (
          <div key={src} className="dd-card px-4 py-4">
            <p className="flex items-center gap-2 text-[13px] text-[#b4b4ba]"><PlatformMark source={src} size={24} />{name}</p>
            <div className="mt-3 flex items-end justify-between"><p><span className="block text-[24px] font-semibold">{n}</span><span className={`text-[12px] ${faint}`}>last 30 days</span></p><Spark pts={[...pts]} /></div>
          </div>
        ))}
        <div className="grid place-items-center rounded-2xl border border-dashed border-[#2a2a30] text-center text-[13px]">
          <div><Plus className="mx-auto size-5 text-[#8f8f96]" /><p className="mt-2">Compare with a competitor</p><p className={`text-[11px] ${faint}`}>See who owns the conversation</p></div>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-[1.9fr_1fr_1fr] gap-4">
        <div className="dd-card h-[330px] p-5">
          <p className={`flex justify-between text-[13px] ${muted}`}><span className="flex items-center gap-2"><TrendingUp className="size-4" />Mentions</span><span className="dd-pill px-3 py-1 text-[12px]">Trends ›</span></p>
          <p className="mt-1 text-[26px] font-semibold">2,418</p><p className={`text-[12px] ${faint}`}>last 30 days</p>
          <svg viewBox="0 0 520 150" className="mt-4 w-full"><path d={line(DAYS, 520, 140, 125)} fill="none" stroke="#e8e8ea" strokeWidth="2" transform="translate(0 6)" />
            <path d={line(DAYS.map((v) => v * 0.18), 520, 140, 125)} fill="none" stroke="#ff3b2f" strokeWidth="2" transform="translate(0 6)" /></svg>
        </div>
        <div className="dd-card h-[330px] p-5">
          <p className={`text-[13px] ${muted}`}>Negative by weekday</p>
          <div className="mt-6 flex h-[200px] items-end gap-3">{[22, 18, 25, 19, 27, 12, 9].map((v, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-2"><span className="w-full rounded-md bg-[#ff3b2f]" style={{ height: `${v * 6}px`, opacity: 0.55 + v / 60 }} /><span className={`text-[11px] ${faint}`}>{"MTWTFSS"[i]}</span></div>
          ))}</div>
        </div>
        <div className="dd-card h-[330px] p-5">
          <p className={`flex justify-between text-[13px] ${muted}`}><span className="flex items-center gap-2"><Inbox className="size-4" />Open issues by kind</span><span className="dd-pill px-3 py-1 text-[12px]">Issues ›</span></p>
          <svg viewBox="0 0 36 36" className="mx-auto mt-6 size-[130px] -rotate-90">{([[46, 0, "#ff3b2f"], [28, 46, "#8b7cf6"], [16, 74, "#f59e0b"], [10, 90, "#3a3a40"]] as const).map(([v, o, c]) => (
            <circle key={c} cx="18" cy="18" r="15" fill="none" stroke={c} strokeWidth="4" pathLength={100} strokeDasharray={`${v - 1} ${101 - v}`} strokeDashoffset={-o} />))}</svg>
          <ul className="mt-4 grid gap-1 text-[12px]">{[["Bugs", 12, "#ff3b2f"], ["Feature requests", 7, "#8b7cf6"], ["Complaints", 4, "#f59e0b"]].map(([n, v, c]) => (
            <li key={n} className="flex items-center gap-2"><i className="size-2 rounded-full" style={{ background: c as string }} />{n}<span className={`ml-auto ${muted}`}>{v}</span></li>))}</ul>
        </div>
      </div>
    </>
  );
}

function Mentions() {
  const max = Math.max(...DAYS);
  const platforms = [["all", "All platforms", "2,418", 100], ["reddit", "Reddit", "812", 34], ["hackernews", "Hacker News", "406", 17], ["app_store", "App Store", "351", 15], ["github", "GitHub", "298", 12], ["youtube", "YouTube", "221", 9]] as const;
  return (
    <>
      <div className="grid grid-cols-[1fr_1.1fr] gap-10">
        <div>
          <Title sub={`Conversations matching the keywords for ${P} · last 30 days`}>Mentions</Title>
          <div className="mt-7"><Big>2,418</Big></div>
          <p className={`mt-5 text-[14px] ${muted}`}>Negative <span className="text-[#ff3b2f]">18%</span> · Positive <span className="text-[#f4f4f5]">41%</span> · 64 in the last 24 hours</p>
          <div className="mt-6 flex gap-2.5"><span data-spot="review" className="dd-btn">Review 37 matches</span><span className="dd-pill px-5 py-2.5 text-[14px]">Trends</span></div>
        </div>
        <div className="grid">
          <div className="justify-self-end"><Periods /></div>
          <div className="mt-4 flex h-[170px] items-end gap-[5px]">{DAYS.map((v, i) => <span key={i} className="dd-bar flex-1 rounded-full" style={{ height: `${(v / max) * 100}%` }} />)}</div>
          <p className={`mt-2 flex justify-between text-[12px] ${faint}`}><span>Sat, Oct 24</span><span>Sun, Nov 22</span></p>
        </div>
      </div>
      <div data-spot="platforms" className="mt-7 grid grid-cols-6 gap-3">
        {platforms.map(([src, name, n, pct], i) => (
          <div key={src} className={`dd-card px-4 py-3.5${i === 0 ? " is-sel" : ""}`}>
            <p className="flex items-center gap-2 text-[13px] text-[#b4b4ba]">{src === "all" ? <span className="grid size-6 place-items-center rounded-full bg-white text-[11px] text-black">✱</span> : <PlatformMark source={src} size={24} />}{name}</p>
            <p className="mt-3 flex items-baseline justify-between"><span className="text-[22px] font-semibold">{n}</span><span className={`text-[11px] ${faint}`}>{pct}%</span></p>
            <div className="mt-2.5 h-1 rounded-full bg-[#26262b]"><div className="h-full rounded-full bg-[#e8e8ea]" style={{ width: `${pct}%` }} /></div>
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-between">
        <div data-spot="views" className="dd-pill flex items-center gap-1 p-1 text-[13px]">
          {[["All", "2,418"], ["Need review", "37"], ["Negative", "435"], ["Positive", "991"]].map(([t, n], i) => (
            <span key={t} className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 ${i === 0 ? "bg-[#1f1f23]" : muted}`}>{i === 2 && <i className="size-1.5 rounded-full bg-[#ff3b2f]" />}{t}<span className="rounded-md bg-[#1f1f23] px-1.5 text-[11px]">{n}</span></span>
          ))}
        </div>
        <div data-spot="search-text" className="dd-pill flex w-[340px] items-center gap-2 py-1 pl-4 pr-1 text-[13px] text-[#6b6b72]"><Search className="size-4" />Search text…<span className="dd-btn ml-auto px-4 py-1.5 text-[13px] text-white">Search</span></div>
      </div>
      <div data-spot="filters" className="mt-4 flex items-center gap-2 text-[13px]">
        {["All platforms", "All types", "Any sentiment", "Relevant + needs review"].map((f) => <span key={f} className="dd-pill flex items-center gap-2 px-3.5 py-2 text-[#b4b4ba]">{f}<ChevronDown className="size-3.5" /></span>)}
        <span className={`ml-2 flex items-center gap-2 ${muted}`}><Square className="size-4" />Duplicates & reposts</span>
      </div>
      <p className={`mt-4 flex justify-between text-[12px] ${muted}`}><span>Showing 1–20 of 2,418 mentions</span><span>Newest first</span></p>
      <div className="dd-card mt-3 flex gap-4 px-5 py-4">
        <PlatformMark source="reddit" size={36} />
        <div className="flex-1"><p className="text-[13px]"><b className="font-medium">Reddit</b> <span className={faint}>· u/maya_sample · 2 hours ago</span></p>
          <p className="mt-1.5 text-[16px]">Export to PDF crashes every time my note is longer than 40 pages. Third time this week.</p></div>
        <span className="h-fit rounded-full bg-[#ff3b2f1f] px-2.5 py-1 text-[11px] text-[#ff8a80]">Bug</span>
      </div>
    </>
  );
}

function Trends() {
  return (
    <>
      <div className="grid grid-cols-[1fr_1fr] gap-8">
        <div>
          <Title sub={`How much attention ${P} gets and whether it's rising`}>Trends</Title>
          <div data-spot="total">
            <p className={`mt-7 text-[13px] ${muted}`}>Mentions · last 30 days</p>
            <div className="mt-3"><Big>2,418</Big></div>
            <p className={`mt-5 text-[12px] ${faint}`}>212 duplicates/reposts not counted</p>
          </div>
          <div className="mt-7 flex gap-10">{[["Unique authors", "1,906"], ["Engagement", "48.2K"], ["Needs review", "37"]].map(([a, b]) => <p key={a}><span className={`block text-[12px] ${muted}`}>{a}</span><span className="text-[22px] font-semibold">{b}</span></p>)}</div>
        </div>
        <div data-spot="compare" className="grid grid-cols-2 gap-3 self-center">
          {([["Today", "87", "Yesterday: 104", ""], ["Last 24 h vs previous 24 h", "87", "−16% (was 104)", ""], ["Last 7 days vs previous 7", "724", "+18% (was 612)", "up"], ["Last 30 days vs previous 30", "2,418", "+31% (was 1,846)", "up"]] as const).map(([a, b, c, up]) => (
            <div key={a} className="dd-card px-4 py-4">
              <p className={`text-[12px] ${muted}`}>{a}</p><p className="mt-2 text-[26px] font-semibold">{b}</p>
              <p className={`mt-1 flex items-center gap-1 text-[12px] ${up ? "text-[#6fd69c]" : faint}`}>{up ? <ArrowUpRight className="size-3.5" /> : c.startsWith("−") ? <ArrowDownRight className="size-3.5" /> : null}{c}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="dd-card mt-6 p-6">
        <p className="text-[20px] font-semibold">Mentions over time</p>
        <p className={`mt-1 text-[12px] ${faint}`}>By publication time (daily). 4 web results without a publication date are not charted.</p>
        <div className="mt-5 flex gap-3 text-[13px]">
          <span data-spot="activity" className="dd-pill flex items-center gap-2 px-4 py-2 text-[#b4b4ba]">All activity (every platform)<ChevronDown className="size-3.5" /></span>
          <span data-spot="range-chips" className="dd-pill flex gap-1 p-1">{["24h", "7d", "30d", "90d", "Custom"].map((r) => <span key={r} className={`rounded-full px-3.5 py-1 ${r === "30d" ? "bg-[#1f1f23]" : muted}`}>{r}</span>)}</span>
        </div>
        <div data-spot="chart" className="mt-5 grid grid-cols-[44px_1fr]">
          <div className={`flex flex-col justify-between pb-6 text-[11px] ${faint}`}>{["125", "100", "75", "50", "25", "0"].map((v) => <span key={v}>{v}</span>)}</div>
          <div>
            <svg viewBox="0 0 1060 250" className="w-full overflow-visible">{[0, 1, 2, 3, 4, 5].map((g) => <line key={g} x1="0" x2="1060" y1={g * 48 + 6} y2={g * 48 + 6} stroke="#1f1f23" />)}
              <path d={line(DAYS, 1060, 240, 125)} fill="none" stroke="#f4f4f5" strokeWidth="2.2" transform="translate(0 6)" /></svg>
            <p className={`mt-2 flex justify-between text-[11px] ${faint}`}>{["Oct 24", "Oct 28", "Nov 1", "Nov 5", "Nov 9", "Nov 13", "Nov 17", "Nov 21"].map((d) => <span key={d}>{d}</span>)}</p>
          </div>
        </div>
        <p className={`mt-3 flex items-center gap-2 text-[12px] ${muted}`}><i className="h-0.5 w-4 bg-[#f4f4f5]" />Mentions (all activity)</p>
      </div>
    </>
  );
}

function Competitors() {
  return (
    <>
      <div className="grid grid-cols-[1fr_1.1fr] gap-10">
        <div>
          <Title sub={`${P} compared with competitors you choose · last 30 days`}>Competitors</Title>
          <p className={`mt-6 max-w-[440px] text-[15px] leading-relaxed text-[#b4b4ba]`}>Add competitors to see who owns the conversation: share of voice, daily volume and sentiment, measured on the same sources over the same time.</p>
          <span data-spot="add" className="dd-btn mt-6 inline-flex items-center gap-2 px-6 py-3"><Plus className="size-4" />Add competitor</span>
        </div>
        <div data-spot="comparison" className="grid place-items-center rounded-2xl border border-dashed border-[#2a2a30] text-center">
          <div><Swords className="mx-auto size-6 text-[#8f8f96]" /><p className="mt-3 text-[15px] font-medium">No comparison yet</p>
            <p className={`mx-auto mt-1 max-w-[420px] text-[13px] ${muted}`}>Add a competitor to compare share of voice, mention volume and sentiment with {P}.</p></div>
        </div>
      </div>
      <p className="mt-10 text-[24px] font-semibold tracking-[-0.02em]">Tracked competitors</p>
      <p className={`mt-1 max-w-[620px] text-[13px] ${muted}`}>Each competitor is searched on the same sources as {P}, on its own schedule. Their mentions count toward your monthly mention allowance. 0 of 2 used.</p>
      <div className="dd-card mt-5 p-6">
        <p className="text-[16px] font-medium">Add a competitor</p>
        <p className={`mt-1 text-[12px] ${muted}`}>Searched on the same sources as your product. Its name uses one of your plan&apos;s keywords, and each extra keyword one more · 1 keyword left.</p>
        <div data-spot="name" className="mt-5 grid grid-cols-3 gap-4 text-[13px]">
          {[["Competitor name", "e.g. Rival Notes", ""], ["Website", "https://", " (optional)"], ["Extra keywords", "rivalnotes.example, Rival app", " (optional)"]].map(([l, ph, o]) => (
            <label key={l} className="grid gap-2"><span>{l}<span className={faint}>{o}</span></span><span className="dd-pill rounded-xl px-4 py-3 text-[#6b6b72]">{ph}</span></label>
          ))}
        </div>
        <div data-spot="fetch" className="mt-4 flex gap-3 rounded-xl border border-[#222226] p-4">
          <Square className="size-5 flex-none text-[#8f8f96]" />
          <div><p className="text-[14px]">Also fetch the last 30 days</p><p className={`mt-1 text-[12px] ${muted}`}>Without this, the competitor starts from today and comparisons begin today. Fetched history uses your monthly mention allowance; the search pauses, keeping what it found, if it runs out.</p></div>
        </div>
        <span className="dd-btn mt-4 inline-block px-4 py-2 text-[13px]">Add competitor</span>
      </div>
    </>
  );
}

function Monitoring() {
  const colors = ["#8b7cf6", "#2fb56b", "#f59e0b", "#ef4444", "#38bdf8"];
  return (
    <>
      <div className="grid grid-cols-[1fr_1fr] gap-8">
        <div>
          <Title>Monitoring</Title>
          <p className={`mt-3 max-w-[440px] text-[14px] ${muted}`}>Every keyword is searched on every platform that supports it. Busier keyword × platform searches are checked more often; quiet ones at least daily.</p>
          <p className={`mt-6 text-[13px] ${muted}`}>Total mentions · last 30 days</p>
          <div className="mt-3"><Big>2,418</Big></div>
          <p className={`mt-5 text-[12px] ${faint}`}>Relevant, duplicates excluded</p>
          <div data-spot="status" className="mt-5 flex w-fit gap-2.5 text-[13px]"><span className="dd-pill flex items-center gap-2 px-4 py-2"><i className="dd-live" />Scanning live</span><span className="dd-pill flex items-center gap-2 px-4 py-2"><Square className="size-3.5" />Stop scan</span></div>
        </div>
        <div className="grid grid-cols-2 gap-3 self-end">
          {[["Active platforms", "15", "Searched for this product", ""], ["Keywords monitored", "3", "All active", ""], ["Last scan", "6 minutes ago", "Nov 22, 2026, 6:26 PM", "scan"], ["Next scan", "in 54 minutes", "Nov 22, 2026, 7:26 PM", "scan"]].map(([a, b, c, s]) => (
            <div key={a} data-spot={s && a === "Last scan" ? "scans" : undefined} className="dd-card px-4 py-4"><p className={`text-[12px] ${muted}`}>{a}</p><p className="mt-2 text-[24px] font-semibold">{b}</p><p className={`mt-1 text-[12px] ${faint}`}>{c}</p></div>
          ))}
        </div>
      </div>
      <div className="mt-6 grid grid-cols-[1.45fr_1fr] gap-4">
        <div data-spot="keywords" className="dd-card p-5">
          <p className="text-[14px]">Keyword performance</p>
          <p className={`mt-1 text-[12px] ${faint}`}>Relevant mentions per keyword, last 30 days, and which platforms they come from.</p>
          <div className="mt-4 grid gap-4 rounded-xl border border-[#222226] p-4">
            {([["Acme Notes", "Brand", 1402, [58, 17, 13, 7, 5]], ["acme app", "", 611, [44, 22, 18, 9, 7]], ["acmenotes.example", "Website", 405, [36, 30, 16, 12, 6]]] as const).map(([t, k, n, mix], i) => (
              <div key={t}>
                <p className="flex items-center gap-2 text-[14px]"><span className={faint}>{i + 1}</span>{t}{k && <span className="rounded bg-[#1f1f23] px-1.5 py-0.5 text-[10px] text-[#8f8f96]">{k}</span>}<span className="ml-auto">{n.toLocaleString("en-US")} mentions</span><ChevronDown className="size-4 text-[#7d7d85]" /></p>
                <div className="mt-2 flex h-2 gap-[3px]" style={{ width: `${(n / 1402) * 100}%` }}>{mix.map((m, j) => <span key={j} className="h-full rounded-full" style={{ width: `${m}%`, background: colors[j] }} />)}</div>
              </div>
            ))}
          </div>
        </div>
        <div data-spot="sources" className="dd-card p-5">
          <p className="text-[14px]">Where mentions come from</p>
          <p className={`mt-1 text-[12px] ${faint}`}>Unique relevant mentions by platform, last 30 days.</p>
          <div className="mt-4 flex gap-5">
            <div className="relative grid size-[140px] flex-none place-items-center">
              <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">{([[34, 0, "#ff4500"], [17, 34, "#ff6600"], [15, 51, "#0a84ff"], [12, 66, "#e8e8ea"], [9, 78, "#ff0033"], [13, 87, "#1185fe"]] as const).map(([v, o, c]) => (
                <circle key={c} cx="18" cy="18" r="15.5" fill="none" stroke={c} strokeWidth="3.2" pathLength={100} strokeDasharray={`${v - 0.8} ${100.8 - v}`} strokeDashoffset={-o} />))}</svg>
              <p className="text-center leading-tight"><span className="block text-[24px] font-semibold">2,418</span><span className={`text-[11px] ${faint}`}>mentions</span></p>
            </div>
            <ul className="grid flex-1 content-center gap-1.5 text-[12px]">{([["reddit", "Reddit", "812 · 34%"], ["hackernews", "Hacker News", "406 · 17%"], ["app_store", "App Store", "351 · 15%"], ["github", "GitHub", "298 · 12%"], ["youtube", "YouTube", "221 · 9%"], ["bluesky", "Bluesky", "174 · 7%"]] as const).map(([s, n, v]) => (
              <li key={s} className="flex items-center gap-2"><PlatformMark source={s} size={18} />{n}<span className={`ml-auto ${muted}`}>{v}</span></li>))}</ul>
          </div>
        </div>
      </div>
      <div data-spot="schedule" className="dd-card mt-4 p-5">
        <p className="text-[14px]">Scan schedule</p>
        <p className={`mt-1 text-[12px] ${faint}`}>When each platform is checked next, over the coming 24 hours. Busier platforms are checked more often.</p>
        <p className={`mt-4 grid grid-cols-[150px_1fr_90px] gap-4 text-[11px] ${faint}`}><span /><span className="flex justify-between"><span>Now</span><span>+6 h</span><span>+12 h</span><span>+18 h</span><span>+24 h</span></span><span /></p>
        {([["reddit", "Reddit", 4, "every 1 h"], ["hackernews", "Hacker News", 4, "every 1 h"], ["app_store", "App Store", 25, "every 6 h"]] as const).map(([s, n, at, e]) => (
          <div key={s} className="mt-3 grid grid-cols-[150px_1fr_90px] items-center gap-4 text-[13px]">
            <span className="flex items-center gap-2"><PlatformMark source={s} size={20} />{n}</span>
            <div className="relative h-1.5 rounded-full bg-[#1f1f23]"><i className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-[#08080a] bg-[#e8e8ea]" style={{ left: `calc(${at}% - 6px)` }} /></div>
            <span className={`text-right ${muted}`}>{e}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function Claude() {
  const groups = [
    ["Workspace", [["Workspace", "Name, members, invites", Building2], ["Products", "Keywords, links, archive", Package], ["Connections", "Google Play reviews", Plug2]]],
    ["Intelligence", [["Heardex Intelligence", "AI classification", Sparkles], ["Claude", "Connector for your Claude", Bot]]],
    ["You", [["Plan & billing", "Plan, usage, invoices", CreditCard], ["Account", "Profile, email, sign-in", UserRound]]],
  ] as const;
  return (
    <>
      <Title sub="Your workspace, products, intelligence and plan.">Settings</Title>
      <div className="mt-8 grid grid-cols-[240px_1fr] gap-6">
        <nav className="grid content-start gap-5">
          {groups.map(([g, items]) => (
            <div key={g} className="grid gap-0.5">
              <p className={`px-3 pb-1 text-[10px] font-medium tracking-[0.14em] uppercase ${faint}`}>{g}</p>
              {items.map(([l, hint, Icon]) => (
                <div key={l} data-spot={l === "Claude" ? "settings-claude" : undefined} className={`dd-nav items-start ${l === "Claude" ? "is-on" : ""}`}>
                  <Icon className="mt-0.5 size-4" strokeWidth={1.6} /><span className="grid leading-tight"><span className="text-[13px]">{l}</span><span className={`text-[11px] ${faint}`}>{hint}</span></span>
                </div>
              ))}
            </div>
          ))}
        </nav>
        <div className="dd-card h-fit p-6">
          <p className="flex items-center gap-3 text-[18px] font-semibold">Heardex for Claude <span className={`rounded-full bg-[#1f1f23] px-2.5 py-0.5 text-[11px] font-normal ${muted}`}>Not connected</span></p>
          <p className={`mt-2 max-w-[600px] text-[14px] leading-relaxed text-[#b4b4ba]`}>Connect Claude to Heardex and Claude can read the feedback and issues for {P}, and investigate issues in your code. Works in Claude on the web, the desktop app and Claude Code, on your own Claude plan.</p>
          <span data-spot="connect" className="dd-btn mt-5 inline-block px-4 py-2 text-[13px]">Connect Claude</span>
          <div data-spot="ask" className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[#222226] p-4"><p className="text-[14px] font-medium">Investigate issues in your code</p><p className={`mt-1.5 text-[13px] ${muted}`}>“Investigate with Claude” on a bug, complaint or feature request opens Claude ready to go: it reads the issue and every report, finds the cause in your code and suggests a fix.</p></div>
            <div className="rounded-xl border border-[#222226] p-4"><p className="text-[14px] font-medium">Ask Claude about your feedback</p>
              <p className={`mt-1.5 grid gap-1 text-[13px] ${muted}`}><span>“What are the top complaints about {P} this week?”</span><span>“Summarize the bug reports about {P} and where they come from.”</span><span>“Which platforms talk about {P} the most?”</span></p></div>
          </div>
          <p className={`mt-4 text-[12px] ${muted}`}>Read-only: Claude sees only this workspace and can&apos;t change anything in Heardex. Disconnect any time; access stops at once.</p>
          <p className="mt-4 rounded-xl border border-[#222226] px-4 py-3 text-[14px]">▸ Having trouble connecting?</p>
        </div>
      </div>
    </>
  );
}

function Keywords() {
  const rows = [["Acme Notes", "Name", true], ["acme app", "Custom", false], ["acmenotes.example", "Website", false]] as const;
  return (
    <div className="w-full">
      <p className={`flex items-center gap-1 px-1 pt-1 text-[14px] ${muted}`}><ChevronLeft className="size-4" />Products</p>
      <div className="dd-card mt-4 mr-8 p-5">
        <p className="text-[17px] font-medium">Keywords for {P}</p>
        <p className={`mt-1.5 text-[13px] ${muted}`}>Changes apply to future monitoring runs. Already-collected mentions are not re-matched.</p>
        <div className="mt-5 grid gap-2.5">
          {rows.map(([k, kind, always], i) => (
            <div key={k} data-spot={i === 0 ? "name" : undefined} className="flex items-center gap-3 rounded-xl border border-[#222226] bg-[#101013] px-4 py-4 text-[14px]">
              <span className={`grid size-[18px] place-items-center rounded ${always ? "bg-[#55555c]" : "bg-[#ff3b2f]"}`}><Check className="size-3.5" strokeWidth={3} /></span>
              <span className="font-medium">{k}</span><span className={`text-[12px] ${faint}`}>{kind}</span>
              {always && <span className="rounded-full bg-[#38bdf81f] px-2.5 py-0.5 text-[11px] text-[#7cc8f2]">Always monitored</span>}
              <span data-spot={i === 0 ? "context" : undefined} className={`ml-auto flex items-center gap-2 text-[13px] ${muted}`}><Square className="size-4" />Needs context</span>
              <Trash2 className="size-4 text-[#8f8f96]" />
            </div>
          ))}
        </div>
        <div data-spot="add" className="mt-3 flex gap-2.5">
          <span className="dd-pill flex-1 rounded-xl px-4 py-2.5 text-[14px] text-[#6b6b72]">Add a keyword, handle or misspelling</span>
          <span className="dd-pill flex items-center gap-1.5 px-4 py-2.5 text-[14px]"><Plus className="size-4" />Add</span>
        </div>
      </div>
    </div>
  );
}

