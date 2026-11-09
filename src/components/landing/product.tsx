"use client";

import { useEffect, useRef, useState } from "react";
import { PlatformMark } from "@/components/brand-logo";
import { cn } from "@/lib/utils";

// Live pieces of the product, built like the dashboard and played like short clips while they
// are on screen. Sample data about a made-up notes app; never presented as a customer.

function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setOn(e!.isIntersecting), { threshold: 0.35 });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return [ref, on] as const;
}

/** Counts 0, 1, 2 … every `ms` while `on`; stands still for reduced motion. */
function useTick(on: boolean, ms: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [on, ms]);
  return n;
}

function Window({ title, right, children, className }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("hx-panel overflow-hidden", className)}>
      <div className="flex h-12 items-center justify-between gap-4 border-b border-[var(--line)] px-5 text-[13px]">
        <span className="font-medium">{title}</span>
        <span className="text-[var(--muted)]">{right}</span>
      </div>
      {children}
    </div>
  );
}

const SENT: Record<string, string> = { Negative: "#e34948", Neutral: "#8f8f96", Positive: "#2a78d6" };
const KIND: Record<string, string> = { Bug: "#e34948", Request: "#2a78d6", Complaint: "#eda100", Testimonial: "#1baf7a" };

const FEED = [
  { source: "reddit", who: "u/marta_writes", where: "r/productivity", text: "Export to PDF crashes every time my note is longer than 40 pages.", sent: "Negative", kind: "Bug" },
  { source: "bluesky", who: "@lena.bsky.social", where: "Bluesky", text: "Nimbus search is genuinely the fastest I've used. Found a 2019 note in a second.", sent: "Positive", kind: "Testimonial" },
  { source: "hackernews", who: "jkl", where: "Hacker News", text: "Would switch the whole team if it had offline mode on iOS.", sent: "Neutral", kind: "Request" },
  { source: "app_store", who: "2 of 5 stars", where: "App Store", text: "Price went up again and sync is still slow. Not happy.", sent: "Negative", kind: "Complaint" },
  { source: "github", who: "devlin", where: "nimbus/desktop #412", text: "Sync stalls at 99% after the 1.8 update on Windows.", sent: "Negative", kind: "Bug" },
  { source: "youtube", who: "Paper & Pixels", where: "YouTube comment", text: "Tried Nimbus after this video, the templates are lovely.", sent: "Positive", kind: "Testimonial" },
  { source: "stackexchange", who: "rk_dev", where: "Stack Overflow", text: "Nimbus API returns 429 on bulk export, any workaround?", sent: "Neutral", kind: "Bug" },
];

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-[var(--line)] px-2.5 text-[12px] text-[var(--ink)]">
      <span className="size-1.5 rounded-full" style={{ background: color }} />{label}
    </span>
  );
}

/** The mentions feed: a new post arrives every couple of seconds and is sorted as it lands. */
export function FeedClip() {
  const [ref, on] = useInView<HTMLDivElement>();
  const n = useTick(on, 2200);
  const rows = Array.from({ length: 5 }, (_, i) => ({ ...FEED[(n + FEED.length * 4 - i) % FEED.length]!, key: n - i }));
  return (
    <div ref={ref}>
      <Window title="Mentions" right={<span className="flex items-center gap-2"><span className="hx-live size-1.5 rounded-full bg-[#1baf7a]" />{(2034 + n).toLocaleString("en-US")} this week</span>}>
        <ul className="grid" aria-label="Sample mentions">
          {rows.map((m, i) => (
            <li key={m.key} className={cn("grid grid-cols-[32px_1fr] gap-3 border-b border-[var(--line)] px-5 py-4 last:border-0", i === 0 && n > 0 && "hx-arrive")}>
              <PlatformMark source={m.source} size={32} />
              <div className="grid min-w-0 gap-2">
                <p className="truncate text-[13px] text-[var(--muted)]"><span className="font-medium text-[var(--ink)]">{m.who}</span> · {m.where} · {i === 0 ? "now" : `${i * 4}m`}</p>
                <p className="text-[15px] leading-snug">{m.text}</p>
                <p className="flex flex-wrap gap-2"><Chip label={m.sent} color={SENT[m.sent]!} /><Chip label={m.kind} color={KIND[m.kind]!} /></p>
              </div>
            </li>
          ))}
        </ul>
      </Window>
    </div>
  );
}

const STEPS = ["About your product", "Negative", "Bug", "Joined an issue"];

/** One post read by the AI, decision by decision, then filed with everyone who said the same. */
export function SortClip() {
  const [ref, on] = useInView<HTMLDivElement>();
  const n = useTick(on, 900);
  const step = n % 7; // 0–4 decisions, then hold
  const reduce = !on && n === 0;
  const shown = reduce ? 4 : Math.min(step, 4);
  return (
    <div ref={ref} className="grid gap-4">
      <div className="hx-panel grid gap-3 p-5">
        <p className="flex items-center gap-3 text-[13px] text-[var(--muted)]"><PlatformMark source="reddit" size={28} /><span><span className="font-medium text-[var(--ink)]">u/marta_writes</span> · r/productivity</span></p>
        <p className="text-[19px] leading-snug">“Export to PDF crashes every time my note is longer than 40 pages. Third time this week.”</p>
      </div>
      <ol className="grid gap-2" aria-label="What the AI decided">
        {STEPS.map((s, i) => (
          <li key={s} className={cn("hx-panel flex items-center justify-between gap-4 px-5 py-3.5 text-[15px] transition-[opacity,transform] duration-300", i < shown ? "opacity-100" : "translate-x-3 opacity-25")}>
            <span className="flex items-center gap-3">
              <span className={cn("grid size-6 place-items-center rounded-full text-[12px] font-semibold", i < shown ? "bg-[var(--red)] text-white" : "bg-[var(--field-3)] text-[var(--muted)]")}>{i + 1}</span>
              {s}
            </span>
            <span className="text-[13px] text-[var(--muted)]">{["Relevant, not another Nimbus", "Frustrated", "Crash on export", "PDF export crashes on long notes"][i]}</span>
          </li>
        ))}
      </ol>
      <div className="hx-panel flex items-center justify-between gap-4 px-5 py-4">
        <span className="grid gap-0.5"><span className="text-[13px] text-[var(--muted)]">Issue · Bug · critical</span><span className="text-[17px] font-semibold">PDF export crashes on long notes</span></span>
        <span className="text-right"><span className="block text-[32px] font-semibold leading-none tracking-[-0.03em]">{shown >= 4 ? 39 : 38}</span><span className="text-[12px] text-[var(--muted)]">reports</span></span>
      </div>
    </div>
  );
}

// 30 days of mentions with one launch-day spike.
const SERIES = [42, 38, 45, 40, 52, 47, 44, 50, 46, 55, 49, 53, 48, 57, 61, 58, 54, 236, 188, 96, 72, 66, 63, 70, 64, 68, 73, 69, 75, 71];

/** The overview chart drawing itself, with the spike and its explanation. */
export function SpikeClip() {
  const [ref, on] = useInView<HTMLDivElement>();
  const W = 560, H = 220, max = 250;
  const pts = SERIES.map((v, i) => [(i / (SERIES.length - 1)) * W, H - (v / max) * H] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [px, py] = pts[17]!;
  return (
    <div ref={ref} className={cn("hx-spike", on && "is-on")}>
      <Window title="Mentions" right="Last 30 days">
        <div className="grid gap-1 px-5 pt-5">
          <p className="text-[40px] font-semibold leading-none tracking-[-0.04em]">2,710</p>
          <p className="text-[13px] text-[var(--muted)]">+64% on the 30 days before</p>
        </div>
        <div className="relative px-5 pb-5 pt-8">
          <svg viewBox={`-4 -12 ${W + 8} ${H + 20}`} className="h-auto w-full overflow-visible" role="img" aria-label="Mentions per day, with a spike on day 18">
            {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="var(--line)" strokeDasharray="2 6" />)}
            <path d={d} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" pathLength={1} className="hx-draw" />
            <circle cx={px} cy={py} r="5" fill="var(--red)" className="hx-dot" />
          </svg>
          <div className="hx-tip hx-panel absolute grid gap-1 p-3 text-[13px]" style={{ left: `calc(${(px / W) * 100}% + 32px)`, top: 24 }}>
            <span className="text-[var(--muted)]">Thu, Oct 15</span>
            <span className="font-medium">236 mentions</span>
            <span className="max-w-[200px] text-[var(--muted)]">A launch thread on Hacker News, 412 points. 61% positive.</span>
          </div>
        </div>
      </Window>
    </div>
  );
}

const TERMINAL = [
  ["›", "Investigating “PDF export crashes on long notes” (39 reports)"],
  ["·", "Read 39 reports through the Heardex connector"],
  ["·", "Searched src/export for the PDF writer"],
  ["·", "src/export/pdf.ts:212 builds every page in memory before writing"],
  ["·", "Crash reproduces above ~38 pages (heap limit on iOS)"],
  ["✓", "Proposed fix: stream pages to disk in batches of 10"],
];

/** Claude investigating an issue: the issue on the left, the session typing on the right. */
export function ClaudeClip() {
  const [ref, on] = useInView<HTMLDivElement>();
  const n = useTick(on, 1100);
  const shown = !on && n === 0 ? TERMINAL.length : Math.min(n % (TERMINAL.length + 3), TERMINAL.length);
  return (
    <div ref={ref} className="grid gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="hx-panel grid content-start gap-4 p-5">
        <span className="text-[13px] text-[#e34948]">Bug · critical · worsening</span>
        <h3 className="text-[22px] font-semibold leading-tight">PDF export crashes on long notes</h3>
        <p className="text-[13px] text-[var(--muted)]">39 reports · 6 days · Reddit, App Store, GitHub</p>
        <div className="grid gap-2 border-t border-[var(--line)] pt-4 text-[13px]">
          {["“Crashes every time my note is longer than 40 pages.”", "“Lost an hour of work when export froze.”", "“Falls over on big docs.”"].map((q) => <p key={q} className="text-[var(--muted)]">{q}</p>)}
        </div>
        <span className="hx-button w-fit !min-h-11 !px-5 !text-[15px]">Investigate with Claude</span>
      </div>
      <div className="hx-panel overflow-hidden bg-[#0a0a0b]">
        <div className="flex h-10 items-center gap-2 border-b border-[var(--line)] px-4 text-[12px] text-[var(--muted)]">
          <span className="size-2.5 rounded-full bg-[#3a3a40]" /><span className="size-2.5 rounded-full bg-[#3a3a40]" /><span className="size-2.5 rounded-full bg-[#3a3a40]" />
          <span className="ml-2">Claude Code · nimbus</span>
        </div>
        <ol className="grid gap-2.5 p-5 font-mono text-[13px] leading-relaxed" aria-label="Claude's investigation">
          {TERMINAL.map(([m, t], i) => (
            <li key={t} className={cn("grid grid-cols-[16px_1fr] gap-2 transition-opacity duration-200", i < shown ? "opacity-100" : "opacity-0")}>
              <span className={m === "✓" ? "text-[#1baf7a]" : m === "›" ? "text-[var(--red)]" : "text-[var(--muted)]"}>{m}</span>
              <span className={m === "✓" ? "text-[var(--ink)]" : "text-[#c9c9cf]"}>{t}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

const VOICE = [
  { name: "Nimbus (you)", share: 46, color: "var(--red)" },
  { name: "Inkwell", share: 31, color: "#6250d6" },
  { name: "Paperlane", share: 23, color: "#1baf7a" },
];

/** Share of the conversation against competitors, growing in when seen. */
export function VoiceClip() {
  const [ref, on] = useInView<HTMLDivElement>();
  return (
    <div ref={ref}>
      <Window title="Competitors" right="Share of voice · 30 days">
        <div className="grid gap-5 p-5">
          {VOICE.map((v, i) => (
            <div key={v.name} className="grid gap-2">
              <p className="flex justify-between text-[15px]"><span>{v.name}</span><span className="font-semibold">{v.share}%</span></p>
              <span className="block h-3 overflow-hidden rounded-full bg-[var(--field-3)]">
                <span className="block h-full rounded-full transition-[width] duration-[1200ms] ease-[cubic-bezier(0.2,0.7,0.2,1)]" style={{ width: on ? `${v.share * 2}%` : "0%", background: v.color, transitionDelay: `${i * 120}ms` }} />
              </span>
            </div>
          ))}
          <p className="border-t border-[var(--line)] pt-4 text-[13px] text-[var(--muted)]">Inkwell mentions up 40% after their sync launch. 9 people said they switched.</p>
        </div>
      </Window>
    </div>
  );
}
