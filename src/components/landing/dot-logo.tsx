"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The sign-in page's picture: a field of dots, the posts about your app all over the internet. They drift, then come
 * together into the Heardex mark, then regroup into three ranked bars (what to fix first, the top one red), then
 * scatter and start again. The dots step aside from the pointer. Reduced motion shows the formed mark, still.
 */

type Pt = { x: number; y: number; red: boolean };
type Shape = { pts: Pt[]; w: number; h: number };

const COUNT = 1500;
const PHASES = [
  { shape: "noise", ms: 2800, caption: "Posts about your app, all over the internet" },
  { shape: "logo", ms: 5200, caption: "Heard and gathered by Heardex" },
  { shape: "bars", ms: 3800, caption: "Ranked into what to fix first" },
] as const;

// The mark's six tiles, as in hero.tsx (HeardexMark), in its own coordinates.
const MARK_BOX = { x: 423, y: 403, w: 1085, h: 1126 };
function drawMark(g: CanvasRenderingContext2D) {
  for (const d of [
    "M423 589a186 186 0 0 1 372 0v309a45 45 0 0 1-45 45H468a45 45 0 0 1-45-45z",
    "M1137 575a371 371 0 0 1 371 371h-371z",
    "M423 985h372v372A372 372 0 0 1 423 985z",
    "M1182 989h281a45 45 0 0 1 45 45v309a186 186 0 0 1-372 0v-309a45 45 0 0 1 46-45z",
  ]) g.fill(new Path2D(d));
  g.beginPath();
  g.roundRect(818, 564, 294, 382, 45);
  g.roundRect(818, 985, 287, 382, 45);
  g.fill();
}

// Three bars, longest first: the issues, ranked. The top one is red.
const BARS_BOX = { x: 0, y: 0, w: 100, h: 74 };
function drawBars(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.roundRect(0, 0, 100, 16, 8);
  g.roundRect(0, 29, 70, 16, 8);
  g.roundRect(0, 58, 44, 16, 8);
  g.fill();
}

/** Points spread over a drawn shape, `n` of them, in units of the shape's width (so its height is h / w). */
function sample(draw: (g: CanvasRenderingContext2D) => void, box: { x: number; y: number; w: number; h: number }, n: number, red: (y: number) => boolean): Shape {
  const W = 260, H = Math.round((W * box.h) / box.w), s = W / box.w;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.setTransform(s, 0, 0, s, -box.x * s, -box.y * s);
  g.fillStyle = "#000";
  draw(g);
  const data = g.getImageData(0, 0, W, H).data;
  const inside = (x: number, y: number) => data[(Math.floor(y) * W + Math.floor(x)) * 4 + 3]! > 128;
  let area = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 128) area++;
  // An even grid of dots over the shape, spaced so there are about `n`; any dots left over double up on grid points.
  const step = Math.sqrt(area / n);
  const grid: [number, number][] = [];
  for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) if (inside(x, y)) grid.push([x, y]);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = i < grid.length ? grid[i]! : grid[Math.floor(Math.random() * grid.length)]!;
    pts.push({ x: x / W, y: y / W, red: red(y / H) });
  }
  // Shuffled, so each dot's place in the shape has nothing to do with where it was before.
  for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pts[i], pts[j]] = [pts[j]!, pts[i]!]; }
  return { pts, w: 1, h: H / W };
}

export function DotLogo({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [caption, setCaption] = useState(0);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const logo = sample(drawMark, MARK_BOX, COUNT, () => false);
    const bars = sample(drawBars, BARS_BOX, COUNT, (y) => y < 0.22);
    // A few dots are red all along: the bugs in the noise.
    const dots = Array.from({ length: COUNT }, () => ({
      x: Math.random(), y: Math.random(), vx: 0, vy: 0,
      hx: Math.random(), hy: Math.random(), seed: Math.random() * 100, delay: Math.random() * 700, red: Math.random() < 0.07,
    }));

    let w = 0, h = 0;
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      w = el.clientWidth; h = el.clientHeight;
      el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    addEventListener("resize", size);

    const colors = { ink: "#f4f4f5", red: "#ff3b2f" };
    const readColors = () => {
      const cs = getComputedStyle(el);
      colors.ink = cs.getPropertyValue("--ink").trim() || colors.ink;
      colors.red = cs.getPropertyValue("--red").trim() || colors.red;
    };
    readColors();
    const themeWatch = new MutationObserver(readColors);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    let pointer: { x: number; y: number } | null = null;
    const onPointer = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onLeave = () => { pointer = null; };
    addEventListener("pointermove", onPointer);
    document.addEventListener("pointerleave", onLeave);

    // Where dot i wants to be in a given phase, in pixels.
    const target = (shape: string, i: number, t: number): [number, number, boolean] => {
      const d = dots[i]!;
      if (shape === "noise") {
        return [(d.hx + Math.sin(t * 0.35 + d.seed) * 0.03) * w, (d.hy + Math.cos(t * 0.3 + d.seed * 1.3) * 0.03) * h, d.red];
      }
      const s = shape === "logo" ? logo : bars;
      const width = shape === "logo" ? Math.min(w * 0.42, h * 0.4) : Math.min(w * 0.5, h * 0.5);
      const p = s.pts[i]!;
      const cy = h * 0.46;
      return [w / 2 + (p.x - 0.5) * width, cy + (p.y - s.h / 2) * width, p.red];
    };

    let phase = still ? 1 : 0;
    let phaseAt = performance.now();
    let prev: string = still ? "logo" : "noise";
    let raf = 0;
    let placed = false; // dots start scattered across the panel once it has a size
    setCaption(phase);

    const frame = (now: number) => {
      if (w && h) {
        const t = now / 1000;
        if (!still && now - phaseAt > PHASES[phase]!.ms) {
          prev = PHASES[phase]!.shape;
          phase = (phase + 1) % PHASES.length;
          phaseAt = now;
          setCaption(phase);
        }
        if (!placed) { for (const d of dots) { d.x = d.hx * w; d.y = d.hy * h; } placed = true; }
        const into = now - phaseAt;
        const shape = PHASES[phase]!.shape;
        ctx.clearRect(0, 0, w, h);
        const reds: number[] = [];
        ctx.fillStyle = colors.ink;
        for (let i = 0; i < COUNT; i++) {
          const d = dots[i]!;
          // Each dot sets off a little after the others, so the shape gathers rather than snaps.
          const [tx, ty, red] = target(into > d.delay ? shape : prev, i, t);
          if (still) { d.x = tx; d.y = ty; } else {
            d.vx = (d.vx + (tx - d.x) * 0.045) * 0.84;
            d.vy = (d.vy + (ty - d.y) * 0.045) * 0.84;
            if (pointer) {
              const dx = d.x - pointer.x, dy = d.y - pointer.y, dist = Math.hypot(dx, dy);
              if (dist < 90 && dist > 0.1) { const f = (1 - dist / 90) * 2.4; d.vx += (dx / dist) * f; d.vy += (dy / dist) * f; }
            }
            d.x += d.vx; d.y += d.vy;
          }
          if (red || (shape === "noise" && d.red)) { reds.push(i); continue; }
          ctx.fillRect(d.x - 1, d.y - 1, 2, 2);
        }
        ctx.fillStyle = colors.red;
        for (const i of reds) ctx.fillRect(dots[i]!.x - 1.1, dots[i]!.y - 1.1, 2.2, 2.2);
      }
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onVisible = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !still) raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVisible);
    // The theme changed inside a view transition (useThemeSwitch): repaint now, so the "after" picture is already new.
    const repaint = () => { readColors(); cancelAnimationFrame(raf); frame(performance.now()); };
    addEventListener("hx:theme", repaint);
    return () => {
      cancelAnimationFrame(raf);
      themeWatch.disconnect();
      removeEventListener("resize", size);
      removeEventListener("pointermove", onPointer);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisible);
      removeEventListener("hx:theme", repaint);
    };
  }, []);

  return (
    <div className={className} aria-hidden>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      <p key={caption} className="hx-dot-caption absolute inset-x-0 bottom-[24%] text-center text-[15px] text-[var(--muted)]">{PHASES[caption]!.caption}</p>
    </div>
  );
}
