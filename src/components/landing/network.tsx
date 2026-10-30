"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { brandMark } from "@/components/brand-logo";

// Every platform Heardex listens on (lib/sources/registry.ts), each with a composer in its own colours and a sample
// post about the made-up app: where it is posted, the composer's label, who posts it, its button.
const PLATFORMS = [
  { source: "reddit", where: "r/productivity", act: "Create post", user: "u/maya_writes", btn: "Post", bg: "#ff4500", fg: "#fff", text: "PDF export crashes every time" },
  { source: "x", where: "Maya", act: "What's happening?", user: "@maya_writes", btn: "Post", bg: "#eff3f4", fg: "#0f1419", text: "Notewise dark mode is so good" },
  { source: "youtube", where: "Notewise vs Notion", act: "Add a comment", user: "@mayawrites", btn: "Comment", bg: "#3ea6ff", fg: "#0f0f0f", text: "Switched after this review, no regrets" },
  { source: "hackernews", where: "Ask HN", act: "add comment", user: "mwrites", btn: "add comment", bg: "#ff6600", fg: "#fff", text: "We moved our docs to Notewise" },
  { source: "github", where: "notewise/desktop", act: "New issue", user: "maya-w", btn: "Submit new issue", bg: "#238636", fg: "#fff", text: "Sync stalls at 99% after 1.8" },
  { source: "stackexchange", where: "Stack Overflow", act: "Ask a question", user: "maya.w", btn: "Post your question", bg: "#0a95ff", fg: "#fff", text: "How do I script a Notewise export?" },
  { source: "dev", where: "DEV Community", act: "Create post", user: "@maya", btn: "Publish", bg: "#3b49df", fg: "#fff", text: "Building my first Notewise plugin" },
  { source: "app_store", where: "Notewise", act: "Write a Review", user: "★★☆☆☆", btn: "Send", bg: "#0a84ff", fg: "#fff", text: "Lost my notes after the update" },
  { source: "google_play", where: "Notewise", act: "Rate this app", user: "★★★★★", btn: "Post", bg: "#01875f", fg: "#fff", text: "Fast, clean, does what it says" },
  { source: "trustpilot", where: "notewise.app", act: "Write a review", user: "★★★★☆", btn: "Submit review", bg: "#00b67a", fg: "#fff", text: "Support replied within the hour" },
  { source: "news", where: "The Verge", act: "New article", user: "Tech desk", btn: "Publish", bg: "#4285f4", fg: "#fff", text: "Notewise ships an offline mode" },
  { source: "web", where: "Google", act: "Search", user: "google.com", btn: "Google Search", bg: "#303134", fg: "#e8eaed", text: "is notewise better than notion" },
  { source: "substack", where: "Maya's Notes", act: "New post", user: "Maya Chen", btn: "Publish", bg: "#ff6719", fg: "#fff", text: "Why I left Notion for Notewise" },
  { source: "facebook", where: "Notewise Users", act: "Write something…", user: "Maya Chen", btn: "Post", bg: "#0866ff", fg: "#fff", text: "Anyone else seeing sync issues?" },
  { source: "instagram", where: "New post", act: "Write a caption", user: "maya.writes", btn: "Share", bg: "#0095f6", fg: "#fff", text: "desk tour ft. Notewise ✨" },
  { source: "tiktok", where: "Upload", act: "Describe your video", user: "@mayawrites", btn: "Post", bg: "#fe2c55", fg: "#fff", text: "my Notewise study setup" },
  { source: "linkedin", where: "Maya Chen", act: "Start a post", user: "Product lead", btn: "Post", bg: "#0a66c2", fg: "#fff", text: "Our whole team moved to Notewise" },
  { source: "bluesky", where: "Maya", act: "What's up?", user: "@maya.bsky.social", btn: "Post", bg: "#1185fe", fg: "#fff", text: "anyone else on Notewise?" },
];

/** A fixed pseudo-random sequence (mulberry32), so the same screen always gets the same scatter. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CYCLE = 26; // seconds, about, for one platform's post to reach Heardex and the next to start
const CARD_H = 104; // the composer's height, about, so it has room above its logo (smaller on phones, landing.css)
const TITLE_H = 120;
const ARRIVE = 0.23; // how far into a platform's round its mention reaches Heardex (nx-run in landing.css) // the heading across the top of the screen

type Pt = { x: number; y: number };

/**
 * The network's drawing: each platform's place and its wire's route, as corners from the platform to its port on
 * Heardex, in the units of the sketch it was drawn on (Heardex the box 953–1117 × 390–558). Wires leave Heardex from
 * all four sides and bend as often as they need to reach their platform without crossing another wire or platform.
 */
const SKETCH = { cx: 1035, cy: 474, hx: 82, hy: 84 };
const ROUTES: Record<string, number[][]> = {
  // Top
  github: [[407, 118], [750, 118], [750, 275], [978, 275], [978, 390]],
  x: [[843, 135], [1008, 135], [1008, 390]],
  hackernews: [[1277, 138], [1048, 138], [1048, 390]],
  instagram: [[1773, 110], [1385, 110], [1385, 280], [1078, 280], [1078, 390]],
  // Left
  dev: [[292, 293], [292, 467], [953, 467]],
  linkedin: [[590, 283], [590, 440], [953, 440]],
  tiktok: [[340, 562], [535, 562], [535, 500], [953, 500]],
  reddit: [[720, 555], [888, 555], [888, 522], [953, 522]],
  // Right
  facebook: [[1532, 277], [1532, 425], [1117, 425]],
  bluesky: [[1902, 270], [1902, 447], [1117, 447]],
  stackexchange: [[1784, 496], [1548, 496], [1548, 470], [1117, 470]],
  youtube: [[1382, 518], [1117, 518]],
  app_store: [[1566, 705], [1283, 705], [1283, 548], [1117, 548]],
  // Bottom
  google_play: [[563, 713], [975, 713], [975, 558]],
  news: [[837, 837], [1003, 837], [1003, 558]],
  trustpilot: [[382, 866], [560, 866], [560, 908], [1035, 908], [1035, 558]],
  web: [[1225, 840], [1065, 840], [1065, 558]],
  substack: [[1826, 772], [1098, 772], [1098, 558]],
};
// How far the sketch reaches beyond Heardex each way.
const EXTENT = { left: 1035 - 82 - 292, right: 1902 - 1035 - 82, up: 474 - 84 - 110, down: 908 - 474 - 84 };

/**
 * The platforms laid out on the screen from the sketch. It is stretched to the screen piece by piece (left, right, up,
 * down, each beyond Heardex), so straight runs stay straight and Heardex keeps its real size; on a tall screen it is
 * turned on its side first.
 */
function layout(w: number, h: number, hub: number) {
  const cx = w / 2, cy = h / 2;
  const size = Math.round(Math.min(44, Math.max(26, Math.min(w, h) * 0.042)));
  const plate = size * 0.88; // the radius of the plate under each logo, with a margin (landing.css)
  const card = Math.min(260, w * 0.5);
  const gap = size / 2 + 12;
  // Up to just under the heading: a platform too near the top for its composer above it has the composer below.
  const box = { x0: 16 + plate, x1: w - 16 - plate, y0: TITLE_H + 16 + plate, y1: h - 16 - plate };
  const half = { x: hub * 0.66, y: hub * 0.68 };
  const tall = h > w;

  // One axis of the sketch onto the screen: Heardex's own width at its real size, the rest stretched each way.
  const axis = (v: number, c: number, hs: number, hr: number, lo: number, hi: number, extLo: number, extHi: number) => {
    const d = v - c;
    if (Math.abs(d) <= hs) return (d / hs) * hr;
    return d < 0 ? -hr - ((-d - hs) / extLo) * lo : hr + ((d - hs) / extHi) * hi;
  };
  // On a small screen Heardex is small for the logos round it, and the wires coming into one side would run too close
  // to pass the platforms beside them; there they run spread as if Heardex were wider, and jog in to it at the end.
  const wide = { x: Math.max(half.x, plate * 2.3), y: Math.max(half.y, plate * 2.3) };
  const toScreen = ([sx, sy]: number[], hub = wide): Pt => {
    // Turned on its side for a tall screen: the sketch's left and right become up and down.
    const [u, v] = tall ? [sy!, sx!] : [sx!, sy!];
    const [cu, cv, hu, hv, eu0, eu1, ev0, ev1] = tall
      ? [SKETCH.cy, SKETCH.cx, SKETCH.hy, SKETCH.hx, EXTENT.up, EXTENT.down, EXTENT.left, EXTENT.right]
      : [SKETCH.cx, SKETCH.cy, SKETCH.hx, SKETCH.hy, EXTENT.left, EXTENT.right, EXTENT.up, EXTENT.down];
    return {
      x: cx + axis(u, cu, hu, hub.x, cx - hub.x - box.x0, box.x1 - cx - hub.x, eu0, eu1),
      y: cy + axis(v, cv, hv, hub.y, cy - hub.y - box.y0, h - 16 - cy - hub.y, ev0, ev1),
    };
  };

  const spots: Pt[] = [], routes: Pt[][] = [];
  PLATFORMS.forEach((p, i) => {
    const sketch = ROUTES[p.source]!;
    const route = sketch.map((q) => toScreen(q));
    const end = route[route.length - 1]!, port = toScreen(sketch[sketch.length - 1]!, half);
    if (Math.hypot(end.x - port.x, end.y - port.y) > 0.5) {
      // The jog: halfway in from the wider edge, across to the port's line, then on in.
      const mid = { x: (end.x + port.x) / 2, y: (end.y + port.y) / 2 };
      // Into Heardex's top or bottom (in the sketch, before any turn onto its side) it comes down or up, else across.
      const [, sy] = sketch[sketch.length - 1]!;
      const vertical = (sy === SKETCH.cy - SKETCH.hy || sy === SKETCH.cy + SKETCH.hy) !== tall;
      route.splice(route.length - 1, 1, vertical ? { x: end.x, y: mid.y } : { x: mid.x, y: end.y }, vertical ? { x: port.x, y: mid.y } : { x: mid.x, y: port.y }, port);
    }
    routes[i] = route;
    spots[i] = route[0]!;
  });

  const nodes = PLATFORMS.map((p, i) => {
    const { x, y } = spots[i]!;
    const rand = seeded(100 + i);
    // From the platform to Heardex: the mention runs that way, and the wire is drawn in from Heardex's end (landing.css).
    const pts = routes[i]!;
    const d = rounded(pts, 22);
    const length = pts.slice(1).reduce((sum, q, k) => sum + Math.hypot(q.x - pts[k]!.x, q.y - pts[k]!.y), 0);
    const mark = brandMark(p.source);
    // Each posts on its own clock, a random pace and a random start, so no order shows.
    const cycle = +(CYCLE * (0.8 + rand() * 0.6)).toFixed(2);
    return {
      ...p, x, y, size, card, gap, mark, d, length,
      route: pts.map((q) => ({ x: q.x - cx, y: q.y - cy })), // from Heardex's centre, for the screen before
      hex: mark?.dark ? "#e8e8ea" : (mark?.hex ?? "#0a66c2"),
      // Kept on screen; lifted over the wires (landing.css), it shows a little larger than its width, so allow for that.
      shift: Math.min(Math.max(0, 24 - x + card * 0.55), w - 24 - x - card * 0.55),
      below: y - gap - CARD_H < TITLE_H,
      cycle, delay: +(-rand() * cycle).toFixed(2),
    };
  });
  // The wires grow out of Heardex at one speed, so each platform is reached at its wire's share of the longest.
  const longest = Math.max(...nodes.map((n) => n.length));
  // Reddit's wire is already there from the screen before (it carries straight on), so it is reached at once.
  return nodes.map((n) => ({ ...n, reach: n.source === "reddit" ? 0.001 : +(n.length / longest).toFixed(3) }));
}

/** A path through the points, each corner rounded (as far as its legs allow). */
export function rounded(pts: { x: number; y: number }[], radius: number) {
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(pts[0]!.x)} ${f(pts[0]!.y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1]!, pts[i]!, pts[i + 1]!];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (r < 0.5) { d += ` L${f(b.x)} ${f(b.y)}`; continue; }
    const p1 = { x: b.x + ((a.x - b.x) / l1) * r, y: b.y + ((a.y - b.y) / l1) * r };
    const p2 = { x: b.x + ((c.x - b.x) / l2) * r, y: b.y + ((c.y - b.y) / l2) * r };
    d += ` L${f(p1.x)} ${f(p1.y)} Q${f(b.x)} ${f(b.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  const z = pts[pts.length - 1]!;
  return `${d} L${f(z.x)} ${f(z.y)}`;
}

function Mark({ path }: { path: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden><path d={path} fill="currentColor" /></svg>;
}

/**
 * The network the scene opens into, lying on the floor round Heardex and, once the floor has turned, filling the screen: every platform's logo scattered round Heardex (which sits at
 * the screen's centre, `hub` pixels wide), each wired to it by a grey run with rounded corners. Each in turn, at random, writes a post in its own composer,
 * sends it, and the post sinks into its logo and runs down the wire. The scene drives it (mention-flight.tsx): --c
 * fades it in, --g (0..1) grows the wires out of Heardex and each platform appears as its wire reaches it, and
 * `is-network` sets the posts going.
 */
/** Reddit's wire in the network: its points from Heardex's centre, and the screen's shorter side they were laid out on. */
export type RedditLink = { route: { x: number; y: number }[]; side: number };

export function Network({ ref, hub, onReddit, onArrive }: {
  ref: Ref<HTMLDivElement>; hub: number; onReddit?: (link: RedditLink) => void; onArrive?: () => void;
}) {
  const [view, setView] = useState<{ w: number; h: number } | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  // Stable, and a new size only when it really changed: the scene re-renders on what this reports (onReddit).
  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new ResizeObserver(([e]) => {
      if (!e) return;
      const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height);
      setView((v) => (v && v.w === w && v.h === h ? v : { w, h }));
    });
    observer.current.observe(el);
  }, []);
  // Measured before it is sized to the screen it is 0 × 0, with no room to lay out.
  const nodes = useMemo(() => (view && view.w > 200 && view.h > 200 ? layout(view.w, view.h, hub * Math.min(view.w, view.h)) : []), [view, hub]);
  // The scene before lays its Reddit and wire out the same way, so the one turns into the other.
  const reddit = nodes.find((n) => n.source === "reddit");
  useEffect(() => {
    if (reddit && view) onReddit?.({ route: reddit.route, side: Math.min(view.w, view.h) });
  }, [reddit, view, onReddit]);

  return (
    <div ref={ref} className="nx" aria-hidden>
      <div ref={measure} className="nx-fill">
        {view && (
          <svg className="nx-wires" viewBox={`0 0 ${view.w} ${view.h}`}>
            {nodes.map((n) => <path key={`c${n.source}`} d={n.d} pathLength={1} className="nx-case" style={{ ["--reach" as string]: n.reach }} />)}
          </svg>
        )}
        {/* The cable itself, lifted a little off its shadow, so on the tilted floor it reads as a solid wire. */}
        {view && (
          <svg className="nx-wires is-lifted" viewBox={`0 0 ${view.w} ${view.h}`}>
            {nodes.map((n) => <path key={`w${n.source}`} d={n.d} pathLength={1} className="nx-wire" style={{ ["--reach" as string]: n.reach }} />)}
            {nodes.map((n) => {
              const timing = { animationDuration: `${n.cycle}s`, animationDelay: `${n.delay}s` };
              return (
                <g key={`p${n.source}`}>
                  <path d={n.d} pathLength={1} className="nx-trail" style={timing} />
                  <path d={n.d} pathLength={1} className="nx-head" style={timing} />
                </g>
              );
            })}
          </svg>
        )}
        {/* A beat for each mention reaching Heardex: one silent animation per platform, its iterations falling as the
            pulse arrives (23% into the round, landing.css), so Heardex answers each arrival and nothing else. */}
        {nodes.map((n) => {
          const at = n.delay + n.cycle * ARRIVE;
          return (
            <span
              key={`a${n.source}`}
              className="nx-arrive"
              style={{ animationDuration: `${n.cycle}s`, animationDelay: `${at}s` }}
              onAnimationStart={() => { if (at >= 0) onArrive?.(); }}
              onAnimationIteration={() => onArrive?.()}
            />
          );
        })}

        {nodes.map((n) => (
          <div
            key={n.source}
            className="nx-node"
            style={{
              left: n.x, top: n.y, ["--hex" as string]: n.hex, ["--size" as string]: `${n.size}px`, ["--gap" as string]: `${n.gap}px`,
              ["--shift" as string]: `${n.shift}px`, ["--side" as string]: n.below ? 1 : -1, ["--reach" as string]: n.reach, ["--cyc" as string]: `${n.cycle}s`, ["--d" as string]: `${n.delay}s`,
            }}
          >
            <span className="nx-burst" />
            {/* The logo, flat on a dark plate that covers its wire's end. */}
            <span className="nx-logo">
              <span className="nx-plate" />
              <span className="nx-mark">{n.mark ? <Mark path={n.mark.path} /> : <b>in</b>}</span>
            </span>
            {/* The composer, in the platform's own colours. */}
            <div className="nx-card" style={{ width: n.card }}>
              <div className="nx-head-row">
                <span className="nx-dot" style={{ background: n.bg, color: n.fg }}>{n.mark ? <Mark path={n.mark.path} /> : "in"}</span>
                <span className="mf-strong">{n.where}</span>
                <span className="mf-dim">· {n.act}</span>
              </div>
              <p className="nx-text"><span>{n.text}</span></p>
              <div className="nx-foot">
                <span className="mf-dim">{n.user}</span>
                <span className="nx-btn" style={{ background: n.bg, color: n.fg }}>{n.btn}</span>
              </div>
              <span className="nx-scan" />
              <svg className="nx-cursor" viewBox="0 0 24 24"><path d="M5 3l14 8-6.2 1.6L10 19z" /></svg>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
