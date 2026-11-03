"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { brandMark } from "@/components/brand-logo";
import { HeardexMark } from "./hero";
import { poseDiveOut, VANISH } from "./dive";
import { DIVE_FROM, DIVE_TO } from "./mention-flight";

// What the customer sees, after the network: the camera flies into Heardex (dive.tsx), and as the flight fades out the
// mentions come up, words on the left and the feed on the right. Then the same panel becomes Heardex's AI at work: its
// bar turns over, the filters go, and the top mention grows into place to be read and sorted. Scrubbed by the scroll, in screen heights from the top of the scene's track (keep in step with its
// height in scenario.tsx).
const AT = (v: number) => DIVE_FROM + (DIVE_TO - DIVE_FROM) * v;
const DARK_FROM = AT(VANISH[0]);
const DARK_TO = AT(VANISH[1]);
const POP_FROM = AT(VANISH[1]) - 0.03;
const POP_TO = AT(VANISH[1]) + 0.45;
const SORT_AT = 7.1; // past here the panel turns over from the feed to the AI's sorting
const RANK_AT = 8.6; // and past here, to the issues the sorted mentions make, ranked
const MCP_AT = 10.1; // and past here, Heardex connected to Claude
// Then the way in, run backwards: Claude fades and the camera flies back out of Heardex's gap and up, until it looks
// down on the mark from overhead, as it did before the dive. Then the mark flies up into the bar, where it was at the
// start, and the page goes on to the pricing.
const OUT_FROM = 11.3;
const OUT_TO = OUT_FROM + (DIVE_TO - DIVE_FROM); // as long as the way in
const BACK_FROM = OUT_TO;
const BACK_TO = BACK_FROM + 1.1;
const HUB = 0.13; // the mark's width overhead, a share of the screen's shorter side (as in mention-flight.tsx)
const FOLLOW_MS = 260; // as softly as the logo's flight (mention-flight.tsx)
const FEED_MS = 2600; // a new mention in the feed, about this often
const READ_MS = 9000;
const GROWN = 2400; // ms after the switch when the picked mention has grown into place (.is-sorted .px-row in landing.css) // one mention read and sorted, then the next

type Tone = "neg" | "pos" | "mid";
type Mention = { source: string; where: string; user: string; text: string; tone: Tone };

// Sample mentions of the made-up app the page follows (Notewise), as they would come in.
const FEED: Mention[] = [
  { source: "reddit", where: "r/productivity", user: "u/maya_writes", text: "Is it just me, or does Notewise crash every time I export a PDF?", tone: "neg" },
  { source: "app_store", where: "App Store · ★★☆☆☆", user: "dan_k", text: "Lost two weeks of notes after the 1.8 update. Please fix sync.", tone: "neg" },
  { source: "x", where: "X", user: "@priya.codes", text: "Notewise dark mode is genuinely the nicest I've used", tone: "pos" },
  { source: "hackernews", where: "Ask HN", user: "mwrites", text: "We moved our whole team's docs to Notewise last month. AMA.", tone: "pos" },
  { source: "github", where: "notewise/desktop", user: "maya-w", text: "Sync stalls at 99% on large vaults since 1.8", tone: "neg" },
  { source: "youtube", where: "Notewise vs Notion", user: "@tomreviews", text: "Would love a proper offline mode before I switch for good", tone: "mid" },
  { source: "trustpilot", where: "Trustpilot · ★★★★☆", user: "Alex R.", text: "Support replied within the hour and sorted my billing.", tone: "pos" },
  { source: "google_play", where: "Google Play · ★☆☆☆☆", user: "Sam O.", text: "PDF export button does nothing on my Pixel", tone: "neg" },
  { source: "stackexchange", where: "Stack Overflow", user: "j.lee", text: "How do I script a Notewise export from the command line?", tone: "mid" },
  { source: "linkedin", where: "LinkedIn", user: "Rina Patel", text: "Notewise saves our design team hours a week. Recommended.", tone: "pos" },
];

const TONE: Record<Tone, string> = { neg: "Negative", pos: "Positive", mid: "Neutral" };
const AGES = ["now", "9s", "31s", "1m", "2m", "4m"];

// What the AI makes of each mention above, in the same order: kind, topic, urgency, and the issue it joins (sample figures).
const READS: { kind: string; topic: string; urgency: [string, Tone | ""]; issue: string; count: number }[] = [
  { kind: "Bug report", topic: "PDF export", urgency: ["High", "neg"], issue: "PDF export crashes", count: 14 },
  { kind: "Bug report", topic: "Sync · data loss", urgency: ["Critical", "neg"], issue: "Notes lost after 1.8 sync", count: 9 },
  { kind: "Praise", topic: "Dark mode", urgency: ["None", ""], issue: "Dark mode praise", count: 31 },
  { kind: "Praise", topic: "Team adoption", urgency: ["None", ""], issue: "Teams switching over", count: 12 },
  { kind: "Bug report", topic: "Sync", urgency: ["High", "neg"], issue: "Sync stalls on large vaults", count: 7 },
  { kind: "Feature request", topic: "Offline mode", urgency: ["Low", ""], issue: "Offline mode", count: 23 },
  { kind: "Praise", topic: "Support", urgency: ["None", ""], issue: "Support praise", count: 18 },
  { kind: "Bug report", topic: "PDF export", urgency: ["High", "neg"], issue: "PDF export crashes", count: 14 },
  { kind: "Question", topic: "Exports · CLI", urgency: ["Low", ""], issue: "Scripting exports", count: 5 },
  { kind: "Praise", topic: "Time saved", urgency: ["None", ""], issue: "Time saved", count: 11 },
];

// The problems those mentions add up to, as the issues page ranks them: by how serious, then by how many raise them
// (sample figures, the same issues as READS). `trend` is mentions a day over the last week.
const ISSUES: { title: string; kind: string; priority: [string, Tone | ""]; count: number; sources: string[]; trend: number[] }[] = [
  { title: "Notes lost after 1.8 sync", kind: "Bug", priority: ["Critical", "neg"], count: 9, sources: ["app_store", "reddit", "github"], trend: [0, 0, 1, 1, 2, 2, 3] },
  { title: "PDF export crashes", kind: "Bug", priority: ["High", "neg"], count: 14, sources: ["reddit", "google_play", "x"], trend: [1, 2, 1, 2, 3, 2, 3] },
  { title: "Sync stalls on large vaults", kind: "Bug", priority: ["High", "neg"], count: 7, sources: ["github", "hackernews"], trend: [0, 1, 1, 1, 1, 2, 1] },
  { title: "Offline mode", kind: "Feature request", priority: ["Medium", "mid"], count: 23, sources: ["youtube", "reddit", "x"], trend: [3, 4, 3, 3, 4, 3, 3] },
  { title: "Scripting exports", kind: "Question", priority: ["Low", ""], count: 5, sources: ["stackexchange", "github"], trend: [1, 0, 1, 1, 0, 1, 1] },
];

const wrap = (n: number) => ((n % FEED.length) + FEED.length) % FEED.length;
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;
const smooth = (from: number, to: number, v: number) => {
  const t = clamp((v - from) / (to - from));
  return t * t * (3 - 2 * t);
};

function Logo({ source }: { source: string }) {
  const m = brandMark(source);
  return (
    <span className="px-logo" style={{ color: m?.dark ? "#e8e8ea" : (m?.hex ?? "#0a66c2") }}>
      {m ? <svg viewBox="0 0 24 24" aria-hidden><path d={m.path} fill="currentColor" /></svg> : <b>in</b>}
    </span>
  );
}

/**
 * Text that turns over from one of `texts` to the next as `at` moves along them, letter by letter: each old letter
 * rolls up and away as the new one rolls up into its place (and back, going the other way). `delay` is when it starts,
 * `step` the gap between letters (ms).
 */
function Roll({ texts, at, delay = 0, step = 14 }: { texts: string[]; at: number; delay?: number; step?: number }) {
  // As wide as the words it shows, easing to the new width as they turn over (so a badge round it fits each in turn).
  const box = useRef<HTMLSpanElement>(null);
  const same = texts.every((t) => t === texts[0]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const shown = el.children[at] as HTMLElement;
    el.style.width = `${shown.offsetWidth}px`;
  }, [texts, at]);
  if (same) return <>{texts[0]}</>;
  const layer = (text: string, li: number) => {
    let i = 0;
    const words = text.split(" ");
    return (
      <span key={li} className={`rl-l${li < at ? " is-past" : li === at ? " is-now" : ""}`}>
        {words.map((w, wi) => (
          <span key={wi}>
            <span className="rl-w">
              {[...w].map((c, ci) => <span key={ci} className="rl-c" style={{ ["--i" as string]: i++ }}>{c}</span>)}
            </span>
            {wi < words.length - 1 ? " " : null}
          </span>
        ))}
      </span>
    );
  };
  return (
    <span ref={box} className="rl" style={{ ["--d" as string]: `${delay}ms`, ["--s" as string]: `${step}ms` }}>
      {texts.map(layer)}
    </span>
  );
}

type Ember = { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; seed: number };

/**
 * Behind the mentions: red light glowing in from two corners, live (it breathes and flickers like a fire), fine grain
 * over it, and tiny embers rising out of the light, cooling from yellow to red as they go. A blurred copy of the
 * embers lights the dark round them. The embers run only while the page is up (`.px.is-up`).
 */
function Embers() {
  const sharp = useRef<HTMLCanvasElement>(null);
  const soft = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const a = sharp.current!;
    const b = soft.current!;
    const root = a.closest<HTMLElement>(".px")!;
    const ctx = a.getContext("2d")!;
    const glow = b.getContext("2d")!;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const embers: Ember[] = [];
    let frame = 0;
    let last = 0;
    let w = 0, h = 0;
    // Where each light is, as a share of the screen, and which way its embers drift (up and in).
    const sources = [
      { x: 0, y: 1, dx: 1, rate: 9 },
      { x: 1, y: 0, dx: -1, rate: 4 },
    ];
    const spawn = (src: (typeof sources)[number]) => {
      // Out of the light: near its corner, spread along both edges.
      const along = Math.random();
      const r = Math.pow(Math.random(), 1.6) * Math.min(w, h) * 0.45;
      const angle = (along * Math.PI) / 2;
      const x = src.x * w + src.dx * Math.cos(angle) * r;
      const y = src.y * h + (src.y ? -1 : 1) * Math.sin(angle) * r;
      embers.push({
        x, y,
        vx: src.dx * (2 + Math.random() * 7),
        vy: -(5 + Math.random() * 12),
        age: 0, life: 8 + Math.random() * 8, size: 0.7 + Math.random() * 1.5, seed: Math.random() * 100,
      });
    };
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      if (!root.classList.contains("is-up")) return;
      if (a.clientWidth !== w || a.clientHeight !== h) {
        w = a.width = b.width = a.clientWidth;
        h = a.height = b.height = a.clientHeight;
      }
      for (const src of sources) {
        let n = src.rate * dt;
        while (n > 1 || Math.random() < n) { spawn(src); n--; }
      }
      const t = now / 1000;
      ctx.clearRect(0, 0, w, h);
      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i]!;
        e.age += dt;
        if (e.age > e.life || e.y < -20 || e.x < -20 || e.x > w + 20) { embers.splice(i, 1); continue; }
        // Rising, swaying on the air, slowing as they cool.
        e.vx += Math.sin(t * 0.6 + e.seed) * 4 * dt;
        e.vy *= 1 - 0.05 * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        const k = e.age / e.life; // 0 new, 1 gone
        const flicker = 0.7 + 0.3 * Math.sin(t * 3 + e.seed * 7);
        const alpha = Math.min(1, k * 5) * (1 - k) * flicker;
        // Yellow-orange when new, red as it cools.
        const g = Math.round(200 * (1 - k) + 50 * k);
        const bl = Math.round(80 * (1 - k) + 30 * k);
        ctx.fillStyle = `rgba(255,${g},${bl},${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size * (1 - k * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      glow.clearRect(0, 0, w, h);
      glow.drawImage(a, 0, 0);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div className="px-fire" aria-hidden>
      <span className="px-flame is-low" />
      <span className="px-flame is-high" />
      <span className="px-grain" />
      <canvas ref={soft} className="is-soft" />
      <canvas ref={sharp} />
    </div>
  );
}

const TABS = ["All", "Reddit", "X", "Reviews", "Code", "News"];

/** The AI's read of one mention: it is scanned, its labels come in one by one, then the issue it joins. */
function Read({ at, first, n }: { at: number; first: boolean; n: number }) {
  const m = FEED[at]!;
  const read = READS[at]!;
  const labels: [string, string, Tone | ""][] = [
    ["Sentiment", TONE[m.tone], m.tone],
    ["Kind", read.kind, ""],
    ["Topic", read.topic, ""],
    ["Urgency", ...read.urgency],
  ];
  // The first one waits for the mention to grow into place; then each step starts as the last settles. For the first,
  // the feed's own row grows into this card (Panel), so this one only holds its place and gives the row its size.
  const base = first ? GROWN : 300;
  return (
    <div key={n} className={`px-read${first ? " is-first" : ""}`}>
      <div className="px-source">
        <Logo source={m.source} />
        <div className="min-w-0 flex-1">
          <div className="px-meta">
            <span className="px-strong">{m.where}</span>
            <span className="px-dim">· {m.user}</span>
          </div>
          <p className="px-quote">{m.text}<span className="px-scan" style={{ animationDelay: `${base}ms` }} /></p>
        </div>
      </div>
      <dl className="px-labels">
        {labels.map(([name, value, tone], i) => (
          <div key={name} className="px-label" style={{ animationDelay: `${base + 1700 + i * 450}ms` }}>
            <dt className="px-dim">{name}</dt>
            <dd className={`px-chip ${tone ? `is-${tone}` : ""}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="px-issue" style={{ animationDelay: `${base + 1700 + 4 * 450 + 300}ms` }}>
        <span className="px-dim">Added to issue</span>
        <span className="px-strong">{read.issue}</span>
        <span className="px-count">{read.count + 1} mentions</span>
      </div>
    </div>
  );
}

/** A week of mentions a day, as a line. */
function Trend({ days }: { days: number[] }) {
  const top = Math.max(...days, 1);
  const points = days.map((d, i) => `${(i / (days.length - 1)) * 64},${22 - (d / top) * 18}`).join(" ");
  return (
    <svg className="px-trend" viewBox="-2 0 68 24" aria-hidden>
      <polyline points={points} />
    </svg>
  );
}

/**
 * The issues the sorted mentions make, ranked. The one the last read mention joined (`joined`) lights up as its count
 * goes up by one.
 */
function Issues({ joined, on }: { joined: string; on: boolean }) {
  return (
    <ol className="px-issues">
      {ISSUES.map((issue, i) => {
        const hit = issue.title === joined;
        return (
          <li key={issue.title} className={`px-is${hit ? " is-hit" : ""}`} style={{ ["--r" as string]: i }}>
            <span className="px-rank">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="px-strong px-is-title">{issue.title}</p>
              <div className="px-is-meta">
                <span className="px-dim">{issue.kind}</span>
                <span className="px-is-from">{issue.sources.map((s) => <Logo key={s} source={s} />)}</span>
              </div>
            </div>
            <Trend days={issue.trend} />
            <span className="px-is-count">
              <Roll texts={[`${issue.count}`, `${issue.count + (hit ? 1 : 0)}`]} at={on && hit ? 1 : 0} delay={1900} step={60} />
              <span className="px-dim"> mentions</span>
            </span>
            <span className={`px-chip ${issue.priority[1] ? `is-${issue.priority[1]}` : ""}`}>{issue.priority[0]}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Claude with Heardex connected (the Heardex MCP connector; src/lib/server/agent/mcp.ts has the real tools): asked
// what to fix, it reads the issues and their reports from Heardex and answers from them. Sample figures, as above.
const QUESTION = "What should I fix first this week?";
const TOOLS = ["get_feedback_issues", "get_issue_evidence"];

/**
 * The Claude app, as you would use it. When `on`: the tools menu opens from the message box and Heardex is switched
 * on, the question is typed and sent, Claude uses Heardex, and its answer comes in (timed in landing.css, .cl).
 */
function ClaudeApp({ on }: { on: boolean }) {
  return (
    <div className={`cl${on ? " is-on" : ""}`} aria-hidden={!on}>
      <nav className="cl-rail">
        <span className="cl-new">+</span>
        <i /><i /><i />
      </nav>
      <div className="cl-main">
        <div className="cl-top"><span>Fix priorities</span></div>
        <div className="cl-chat">
          <p className="cl-you">{QUESTION}</p>
          <div className="cl-used">
            <span className="cl-tick"><i /><svg viewBox="0 0 16 16" aria-hidden><path d="m3.5 8.5 3 3 6-7" /></svg></span>
            <HeardexMark className="cl-hx h-3.5 w-3.5 flex-none" />
            <span>Used Heardex</span>
            <span className="cl-tools">{TOOLS.map((t) => <code key={t}>{t}</code>)}</span>
          </div>
          <div className="cl-say">
            <p>Start with <b>Notes lost after 1.8 sync</b>. It is your one critical issue: 9 reports this week from the App Store, Reddit and GitHub, and rising. People say edits made offline disappear after a sync.</p>
            <p>Then <b>PDF export crashes</b>: 15 reports, most of them from Android.</p>
          </div>
        </div>
        <div className="cl-box">
          <div className="cl-menu">
            <p className="cl-menu-head">Search and tools</p>
            <div className="cl-item"><span className="cl-globe" />Web search<span className="cl-switch is-set"><i /></span></div>
            <div className="cl-item is-hx"><span className="cl-app"><HeardexMark className="h-3 w-3" /></span>Heardex<span className="cl-switch"><i /></span></div>
          </div>
          <p className="cl-field">
            <span className="cl-hint">Reply to Claude…</span>
            <span className="cl-typed">{[...QUESTION].map((c, i) => <span key={i} style={{ ["--i" as string]: i }}>{c}</span>)}</span>
          </p>
          <div className="cl-actions">
            <span className="cl-btn">+</span>
            <span className="cl-btn is-tools"><svg viewBox="0 0 16 16" aria-hidden><path d="M2 5h7M12 5h2M2 11h2M7 11h7" /><circle cx="10.5" cy="5" r="1.5" /><circle cx="5.5" cy="11" r="1.5" /></svg></span>
            <span className="cl-model">Opus 5.5</span>
            <span className="cl-send"><svg viewBox="0 0 16 16" aria-hidden><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></svg></span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The one panel: the feed of mentions, newest (`head`) at the top. When `sorted`, the bar's words turn over to the
 * AI's, the filters go up and away, the rest of the feed falls away and the top mention grows into place, to be read
 * and sorted; then the next, every READ_MS (`k`). At `step` 2 the bar turns over again, the read goes, and the issues
 * come up in its place, ranked.
 */
function Panel({ head, step, k }: { head: number; step: 0 | 1 | 2; k: number }) {
  const sorted = step > 0;
  const ranked = step === 2;
  const rows = AGES.map((age, i) => ({ age, at: wrap(head - i) }));
  // The top row grows to the size of the first read's card, which sits exactly where it ends up.
  const panel = useRef<HTMLDivElement>(null);
  // The panel's body fits each read in turn, however many lines its mention takes.
  useLayoutEffect(() => {
    const el = panel.current!;
    const card = el.querySelector<HTMLElement>(".px-read.is-first .px-source");
    if (card) el.style.setProperty("--card-h", `${card.offsetHeight}px`);
    const read = el.querySelector<HTMLElement>(".px-read");
    if (read) el.style.setProperty("--read-h", `${read.scrollHeight}px`);
  }, [step, head, k]);
  return (
    <div ref={panel} className={`px-panel${sorted ? " is-sorted" : ""}${ranked ? " is-ranked" : ""}`}>
      <div className="px-bar">
        <HeardexMark className="px-hx" />
        <span className="px-strong"><Roll texts={["Mentions", "Heardex AI", "Issues"]} at={step} step={35} /></span>
        <span className="px-live"><i /><Roll texts={[`${3 + head} new`, "Classifying", "Ranked"]} at={step} delay={150} step={35} /></span>
        <span className="px-dim ml-auto"><Roll texts={["Notewise", `${(1284 + k).toLocaleString("en-US")} sorted today`, "This week"]} at={step} delay={300} step={25} /></span>
      </div>
      <div className="px-tabs-wrap">
        <div className="px-tabs">
          {TABS.map((t, i) => <span key={t} className={i ? "" : "is-on"}>{t}</span>)}
        </div>
      </div>
      <div className={`px-body${k ? " is-next" : ""}`}>
        {/* Keyed by the newest: each new mention slides the whole list down a row. */}
        <ul key={head} className={`px-rows${k ? " is-done" : ""}`}>
          {rows.map(({ age, at }, r) => {
            const m = FEED[at]!;
            return (
              <li key={r} className="px-row" style={{ ["--r" as string]: r }}>
                <Logo source={m.source} />
                <div className="min-w-0 flex-1">
                  <div className="px-meta">
                    <span className="px-strong">{m.where}</span>
                    <span className="px-dim">· {m.user} · {age}</span>
                  </div>
                  <p className="px-text">
                    {m.text}
                    {sorted && r === 0 && <span className="px-scan" style={{ animationDelay: `${GROWN}ms` }} />}
                  </p>
                </div>
                <span className={`px-chip is-${m.tone}`}>{TONE[m.tone]}</span>
              </li>
            );
          })}
        </ul>
        {sorted && <Read at={wrap(head + k)} first={k === 0} n={k} />}
        {sorted && <Issues joined={READS[wrap(head + k)]!.issue} on={ranked} />}
      </div>
    </div>
  );
}

// The words beside the panel at each step: the feed, the AI's sorting, the issues, Claude.
const HEADS: [string, string][] = [
  ["All your mentions, in one place.", "Posts, reviews and comments that name your product, gathered from each platform and checked so the feed is about you."],
  ["Then our AI sorts each one.", "It reads every mention for sentiment, what kind of feedback it is and what it is about, and puts it with the issue it belongs to."],
  ["Ranked into issues.", "Mentions of the same problem become one issue. The issues are ranked by how serious they are and how many people raise them, so you know what to fix first."],
  ["Your feedback, inside Claude.", "Connect Heardex to Claude once with our MCP connector. Your issues, the reports behind them and your product's context are there whenever you ask Claude about them."],
];

/**
 * Over the network: the ground the flight fades onto, then the words and the panel. `--k` is the ground (0..1), `--p`
 * the panel coming up (0..1). Past SORT_AT the panel and the words turn over to what the AI does.
 */
export function Process() {
  const root = useRef<HTMLDivElement>(null);
  // 0 hidden, 1 the feed running, 2 sorted (the feed holds still while it turns over), 3 ranked into issues.
  const [phase, setPhase] = useState<0 | 1 | 2 | 3 | 4>(0);
  const live = useRef(phase); // the phase as the scroll last set it, for the effects' clean-ups
  const [head, setHead] = useState(0);
  const [k, setK] = useState(0);

  useEffect(() => {
    if (phase !== 1) return;
    const id = setInterval(() => setHead((h) => h + 1), FEED_MS);
    return () => clearInterval(id);
  }, [phase]);
  const reading = phase === 2;
  useEffect(() => {
    if (!reading) return;
    // The first read waits for the mention to grow into place.
    let id = 0;
    const first = window.setTimeout(() => { id = window.setInterval(() => setK((v) => v + 1), READ_MS); }, GROWN);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      // On to the issues, the last read stays as it was (its issue is the one lit up); back to the feed, it starts over.
      if (live.current < 2) setK(0);
    };
  }, [reading]);

  useEffect(() => {
    const el = root.current!;
    const track = el.closest<HTMLElement>("[data-flight-track]");
    const stage = el.querySelector<HTMLElement>(".px-stage")!;
    const from = el.querySelector<HTMLElement>(".cl-hx")!;
    const fire = el.querySelector<HTMLElement>(".px-fire");
    const source = document.querySelector<HTMLElement>("[data-flight-source]");
    const fly = document.querySelector<HTMLElement>("[data-flight-home]");
    const bar = source?.closest("header");
    const dive = el.closest("section")?.querySelector<HTMLElement>("[data-dive]");
    // The way out, 0..1: Claude and the fire go first, then the ground under them clears as the flight comes back up
    // in reverse (the same window it went dark in on the way in).
    const leave = (o: number, v: number) => {
      const gone = smooth(OUT_FROM - 0.35, OUT_FROM + 0.1, v);
      stage.style.opacity = gone ? `${1 - gone}` : "";
      stage.style.filter = gone ? `blur(${gone * 10}px)` : "";
      if (fire) fire.style.opacity = gone ? `${1 - gone}` : "";
      if (dive) poseDiveOut(dive, o);
      return o ? smooth(VANISH[0], VANISH[1], VANISH[1] * (1 - o)) : 1;
    };
    // The flight home, 0..1: the mark, flat again overhead in the middle of the screen, turns once on its way up and
    // comes down to its place in the bar; there the bar takes it back (its loop starts again) and the name opens up.
    const home = (r: number) => {
      from.style.visibility = r > 0 ? "hidden" : "";
      // The name makes room just before the mark arrives; mention-flight.tsx leaves the bar alone once it is back.
      const back = r >= 1;
      const room = r > 0.75;
      if (bar && room !== bar.classList.contains("is-back")) {
        bar.classList.toggle("is-back", room);
        bar.classList.toggle("is-flown", !room);
      }
      if (source && r > 0) source.style.visibility = back ? "" : "hidden";
      bar?.classList.toggle("is-home", back); // its loop starts again as it lands
      if (!fly || !source) return;
      fly.style.visibility = r > 0 && !back ? "visible" : "";
      if (!r || back) return;
      const b = source.getBoundingClientRect();
      // Overhead the mark is HUB of the shorter side across; the flat one's box is square and as tall as the mark.
      const start = Math.min(innerWidth, innerHeight) * HUB * (1126 / 1085);
      const go = easeInOut(r);
      const size = Math.exp(Math.log(start) + (Math.log(b.width) - Math.log(start)) * go);
      const x = innerWidth / 2 + (b.left + b.width / 2 - innerWidth / 2) * go;
      const y = innerHeight / 2 + (b.top + b.height / 2 - innerHeight / 2) * go - innerHeight * 0.1 * Math.sin(Math.PI * go);
      fly.style.width = fly.style.height = `${b.width}px`;
      fly.style.transform = `translate(${x - b.width / 2}px, ${y - b.width / 2}px) scale(${size / b.width}) rotate(${-14 * Math.sin(Math.PI * go)}deg)`;
      // The solid mark had no glow; the flat one gains the bar's as it goes.
      fly.style.filter = `drop-shadow(0 0 18px rgb(255 59 47 / ${(0.35 * go).toFixed(3)}))`;
    };
    let at = -1;
    let last = 0;
    let queued = 0;
    const place = (now: number) => {
      queued = 0;
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      at = at < 0 ? scrollY : at + (scrollY - at) * (1 - Math.exp(-dt / FOLLOW_MS));
      if (Math.abs(scrollY - at) < 0.5) at = scrollY;
      const v = (at - (track?.offsetTop ?? 0)) / innerHeight;
      const k = smooth(DARK_FROM, DARK_TO, v) * leave(clamp((v - OUT_FROM) / (OUT_TO - OUT_FROM)), v);
      const p = smooth(POP_FROM, POP_TO, v);
      el.style.setProperty("--k", k.toFixed(4));
      el.style.setProperty("--p", p.toFixed(4));
      el.classList.toggle("is-up", k > 0);
      live.current = v > MCP_AT ? 4 : v > RANK_AT ? 3 : v > SORT_AT ? 2 : p > 0.5 ? 1 : 0;
      setPhase(live.current);
      home(clamp((v - BACK_FROM) / (BACK_TO - BACK_FROM)));
      if (at !== scrollY) queued = requestAnimationFrame(place);
      else last = 0;
    };
    const queue = () => { queued ||= requestAnimationFrame(place); };
    queue();
    addEventListener("scroll", queue, { passive: true });
    addEventListener("resize", queue);
    return () => {
      cancelAnimationFrame(queued);
      removeEventListener("scroll", queue);
      removeEventListener("resize", queue);
      bar?.classList.remove("is-back", "is-home");
    };
  }, []);

  const step = phase < 2 ? 0 : ((phase - 1) as 1 | 2 | 3);
  const mcp = step === 3;
  // Each heading and line under it is gone (past), showing (now), or still to come.
  const at = (i: number) => (i < step ? " is-past" : i === step ? " is-now" : "");
  return (
    <div ref={root} className="px" aria-hidden={phase === 0}>
      <div className="px-veil" />
      <Embers />
      <div className="px-stage">
        {/* Each switch: the heading grows, then goes off to the left as the next rises from below; the line under it
            fades out and the next fades in. */}
        <div className="px-words">
          <div className="px-heads">
            {HEADS.map(([h], i) => <h3 key={i} className={`px-head${at(i)}`} aria-hidden={i !== step}>{h}</h3>)}
          </div>
          <div className="px-subs">
            {HEADS.map(([, sub], i) => <p key={i} className={`px-sub${at(i)}`} aria-hidden={i !== step}>{sub}</p>)}
          </div>
        </div>
        <div className={`px-slot${mcp ? " is-mcp" : ""}`}>
          <Panel head={head} step={Math.min(step, 2) as 0 | 1 | 2} k={k} />
          <ClaudeApp on={mcp} />
        </div>
      </div>
    </div>
  );
}
