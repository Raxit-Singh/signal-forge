"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { RedFlow } from "./red-flow";

// Candidate hero backgrounds, chosen with ?bg=eclipse|waves|dots|tiles|lines|smoke while we decide.
// All are black with red, move slowly, react to the pointer, and hold still for reduced motion.

export type BackgroundKind = "eclipse" | "waves" | "dots" | "tiles" | "lines" | "smoke";
const KINDS: BackgroundKind[] = ["eclipse", "waves", "dots", "tiles", "lines", "smoke"];

type Pointer = { x: number; y: number; vx: number; vy: number; at: number } | null;
type Scene = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, p: Pointer) => void;

const RED = "255, 59, 47";
const gauss = (d2: number, r: number) => Math.exp(-d2 / (r * r));

/**
 * A dark planet rising from the bottom edge with a thin red rim of light and a soft red atmosphere above it,
 * signals travelling along the rim, a faint dot grid fading out above, and a cool light from the top.
 * The rim brightens where the pointer is, and the light and grid shift a little with it.
 *
 * It enters like a sunrise when the answer arrives (ENTER_AT): the planet rises from below the screen, a flash
 * bursts at its crown, the rim lights from the centre outward with two hot points racing to the edges, the air
 * blooms, and the grid and the signals arrive last.
 */
const ENTER_AT = 3.9; // seconds; keep in step with --answer in landing.css
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const outExpo = (v: number) => (v >= 1 ? 1 : 1 - 2 ** (-10 * v));
const outCubic = (v: number) => 1 - (1 - v) ** 3;
/** Whether the site is in light (next-themes puts .light on <html>); kept up to date by the canvas while it runs. */
const theme = { light: false };
/** How far the planet has risen past its resting place, 0..1 of the screen height; set by the scroll (mention-flight.tsx). */
export const horizon = { lift: 0 };

function eclipse(): Scene {
  let grid: HTMLCanvasElement | null = null;
  let gridFor = "";
  let lx = 0.5; // where along the rim the light sits, 0..1 across the screen, eased toward the pointer
  const signals = [0.12, 0.47, 0.81].map((at, i) => ({ at, speed: 0.018 + i * 0.006 }));
  return (ctx, w, h, t, p) => {
    ctx.clearRect(0, 0, w, h);
    const e = t - ENTER_AT;
    if (e <= 0) return;
    // The entrance, each part 0..1.
    const rise = outExpo(clamp01(e / 2.2));
    const light = outCubic(clamp01((e - 0.5) / 1.6)); // how far the rim has lit, from the centre out
    const flash = clamp01((e - 0.45) / 0.25) * (1 - clamp01((e - 0.7) / 1.6));
    const air = outCubic(clamp01((e - 0.6) / 1.8));
    const late = outCubic(clamp01((e - 1.6) / 1.4)); // grid, top light, signals

    lx += ((p ? p.x / w : 0.5 + Math.sin(t * 0.15) * 0.18) - lx) * 0.04;
    const px = p ? p.x / w - 0.5 : 0, py = p ? p.y / h - 0.5 : 0;

    // The dot grid, drawn once per size and faded out toward the edges and the planet.
    if (gridFor !== `${w}x${h}${theme.light}`) {
      gridFor = `${w}x${h}${theme.light}`;
      grid = document.createElement("canvas");
      grid.width = w; grid.height = h;
      const g = grid.getContext("2d")!;
      for (let y = 16; y < h; y += 32) for (let x = 16; x < w; x += 32) {
        const a = 0.13 * gauss((x - w / 2) ** 2, w * 0.42) * gauss((y - h * 0.35) ** 2, h * 0.42);
        if (a < 0.004) continue;
        g.fillStyle = theme.light ? `rgba(12, 12, 13, ${a * 1.4})` : `rgba(255, 255, 255, ${a})`;
        g.fillRect(x, y, 1.2, 1.2);
      }
    }
    ctx.globalAlpha = late;
    ctx.drawImage(grid!, -px * 14, -py * 10);

    // A cool, very faint light from above.
    const top = ctx.createRadialGradient(w / 2 + px * 80, -h * 0.15, 0, w / 2 + px * 80, -h * 0.15, h * 0.95);
    top.addColorStop(0, theme.light ? "rgba(255, 255, 255, 0.5)" : "rgba(255, 255, 255, 0.07)");
    top.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    // The planet: its top edge rises from below the screen to 80% of the height, then on with the scroll until it
    // fills the screen and its dark side becomes the ground of the next page.
    const R = Math.max(w * 0.95, h * 1.1);
    const crown = h * (1.25 - 0.45 * rise - horizon.lift);
    const cx = w / 2, cy = crown + R;
    const breathe = 0.85 + Math.sin(t * 0.5) * 0.15;
    const atmosphere = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R + h * 0.38);
    atmosphere.addColorStop(0, `rgba(${RED}, ${0.32 * breathe * air + flash * 0.35})`);
    atmosphere.addColorStop(0.25, `rgba(${RED}, ${0.1 * breathe * air + flash * 0.12})`);
    atmosphere.addColorStop(1, `rgba(${RED}, 0)`);
    ctx.fillStyle = atmosphere;
    ctx.fillRect(0, 0, w, h);

    // The flash at the crown as the rim ignites.
    if (flash > 0) {
      const burst = ctx.createRadialGradient(cx, crown, 0, cx, crown, w * 0.45);
      burst.addColorStop(0, `rgba(255, 220, 210, ${0.55 * flash})`);
      burst.addColorStop(0.15, `rgba(${RED}, ${0.35 * flash})`);
      burst.addColorStop(1, `rgba(${RED}, 0)`);
      ctx.fillStyle = burst;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = theme.light ? "#f6f5f2" : "#050506"; // the page's ground, in either theme
    ctx.fill();

    // The rim: lit from the crown outward, brightest where the light is, fading to nothing at both sides.
    const span = Math.asin(Math.min(w / 2 / R, 1)) * 1.15; // a little past the visible half-angle
    const reach = span * light;
    if (reach > 0.001) {
      const rim = ctx.createLinearGradient(0, 0, w, 0);
      const at = Math.min(Math.max(lx, 0.05), 0.95);
      rim.addColorStop(0, `rgba(${RED}, 0)`);
      rim.addColorStop(Math.max(at - 0.3, 0.01), `rgba(${RED}, 0.55)`);
      rim.addColorStop(at, "rgba(255, 170, 150, 1)");
      rim.addColorStop(Math.min(at + 0.3, 0.99), `rgba(${RED}, 0.55)`);
      rim.addColorStop(1, `rgba(${RED}, 0)`);
      ctx.save();
      ctx.shadowColor = `rgba(${RED}, 0.9)`;
      ctx.shadowBlur = 18 + flash * 30;
      ctx.beginPath();
      ctx.arc(cx, cy, R, -Math.PI / 2 - reach, -Math.PI / 2 + reach);
      ctx.strokeStyle = rim;
      ctx.lineWidth = 1.6 + flash * 1.4;
      ctx.stroke();
      ctx.restore();

      // The two hot points at the ends of the lit rim, racing outward, gone once the rim is whole.
      const heat = 1 - light;
      if (heat > 0.01) {
        for (const side of [-1, 1]) {
          const a2 = -Math.PI / 2 + side * reach;
          const x = cx + Math.cos(a2) * R, y = cy + Math.sin(a2) * R;
          const spark = ctx.createRadialGradient(x, y, 0, x, y, 60);
          spark.addColorStop(0, `rgba(255, 235, 225, ${heat})`);
          spark.addColorStop(0.12, `rgba(${RED}, ${0.7 * heat})`);
          spark.addColorStop(1, `rgba(${RED}, 0)`);
          ctx.fillStyle = spark;
          ctx.fillRect(x - 60, y - 60, 120, 120);
        }
      }
    }

    // Signals running along the rim, each a bright point with a short fading trail.
    if (late > 0) {
      const seen = span / 1.15;
      for (const s of signals) {
        const u = (s.at + (t - ENTER_AT) * s.speed) % 1;
        for (let k = 0; k < 14; k++) {
          const a3 = -Math.PI / 2 - seen + 2 * seen * (u - k * 0.0035);
          const x = cx + Math.cos(a3) * R, y = cy + Math.sin(a3) * R;
          const fade = late * (1 - k / 14) * Math.sin(u * Math.PI); // fades in and out at the ends of the rim
          ctx.fillStyle = k === 0 ? (theme.light ? `rgba(${RED}, ${fade})` : `rgba(255, 210, 200, ${fade})`) : `rgba(${RED}, ${fade * 0.6})`;
          ctx.beginPath();
          ctx.arc(x, y, k === 0 ? 2.2 : 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  };
}

/** Thin red lines like an audio waveform; they swell and bend where the pointer moves. */
function waves(): Scene {
  return (ctx, w, h, t, p) => {
    ctx.clearRect(0, 0, w, h);
    const lines = 9;
    for (let i = 0; i < lines; i++) {
      const base = h * (0.12 + (0.76 * i) / (lines - 1));
      const centre = 1 - Math.abs(i - (lines - 1) / 2) / ((lines - 1) / 2); // middle lines sit behind the headline
      ctx.beginPath();
      for (let x = 0; x <= w + 8; x += 8) {
        const u = x / w;
        let y = base
          + Math.sin(u * 9 + t * 0.6 + i * 0.7) * h * 0.012
          + Math.sin(u * 23 - t * 1.1 + i * 1.9) * h * 0.005;
        if (p) {
          const near = gauss((x - p.x) ** 2, w * 0.12) * gauss((base - p.y) ** 2, h * 0.22);
          y += Math.sin(u * 60 - t * 6 + i) * near * h * 0.035;
        }
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${RED}, ${0.38 - centre * 0.24})`;
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }
  };
}

/** A fine dot grid. The pointer sends ripples through it; now and then a dot flashes red, like a mention arriving. */
function dots(): Scene {
  const ripples: { x: number; y: number; at: number; red: boolean }[] = [];
  let lastRipple = 0, lastFlash = 0;
  return (ctx, w, h, t, p) => {
    ctx.clearRect(0, 0, w, h);
    const now = t * 1000;
    if (p && now - p.at < 100 && now - lastRipple > 140) { ripples.push({ x: p.x, y: p.y, at: now, red: false }); lastRipple = now; }
    if (now - lastFlash > 700) { ripples.push({ x: Math.random() * w, y: Math.random() * h, at: now, red: true }); lastFlash = now; }
    while (ripples.length && now - ripples[0]!.at > 2600) ripples.shift();

    const gap = 26;
    for (let y = gap / 2; y < h; y += gap) {
      for (let x = gap / 2; x < w; x += gap) {
        let lift = 0, red = 0;
        for (const r of ripples) {
          const age = (now - r.at) / 1000;
          const d = Math.hypot(x - r.x, y - r.y);
          const ring = gauss((d - age * 260) ** 2, 18) * Math.max(0, 1 - age / 2.6);
          lift += ring;
          if (r.red) red += ring + gauss(d * d, 10) * Math.max(0, 1 - age / 1.2) * 3;
        }
        const a = Math.min(0.14 + lift * 0.5, 1);
        ctx.fillStyle = red > 0.05 ? `rgba(${RED}, ${Math.min(0.2 + red, 1)})` : `rgba(255, 255, 255, ${a})`;
        const s = 1.6 + Math.min(lift + red, 2) * 1.2;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
    }
  };
}

/** A wall of the logo's rounded tiles. Tiles near the pointer lift and turn red; random tiles light up and fade. */
function tiles(): Scene {
  const lit = new Map<string, number>();
  let lastLight = 0;
  return (ctx, w, h, t, p) => {
    ctx.clearRect(0, 0, w, h);
    const now = t * 1000;
    const size = 44, gap = 6, step = size + gap;
    const cols = Math.ceil(w / step) + 1, rows = Math.ceil(h / step) + 1;
    if (now - lastLight > 350) { lit.set(`${Math.floor(Math.random() * cols)},${Math.floor(Math.random() * rows)}`, now); lastLight = now; }
    for (const [k, at] of lit) if (now - at > 2400) lit.delete(k);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * step - (step - (w % step)) / 2, y = r * step - (step - (h % step)) / 2;
        const cx = x + size / 2, cy = y + size / 2;
        const near = p ? gauss((cx - p.x) ** 2 + (cy - p.y) ** 2, 110) : 0;
        const at = lit.get(`${c},${r}`);
        const glow = at === undefined ? 0 : Math.sin(Math.min((now - at) / 2400, 1) * Math.PI);
        const heat = Math.min(near + glow, 1);
        const s = size * (1 + near * 0.12);
        ctx.fillStyle = heat > 0.02 ? `rgba(${RED}, ${0.05 + heat * 0.4})` : "rgba(255, 255, 255, 0.025)";
        ctx.beginPath();
        ctx.roundRect(cx - s / 2, cy - s / 2, s, s, 8);
        ctx.fill();
      }
    }
  };
}

/** Long, thin streaks of red light gliding left to right; they bend away from the pointer. */
function lines(): Scene {
  const streaks = Array.from({ length: 11 }, (_, i) => ({
    y: 0.08 + (0.84 * i) / 10 + (Math.random() - 0.5) * 0.04,
    speed: 0.05 + Math.random() * 0.07,
    length: 0.25 + Math.random() * 0.35,
    offset: Math.random(),
  }));
  return (ctx, w, h, t, p) => {
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";
    for (const s of streaks) {
      const head = ((s.offset + t * s.speed) % (1 + s.length)) * w;
      const tail = head - s.length * w;
      const baseY = s.y * h;
      const grad = ctx.createLinearGradient(tail, 0, head, 0);
      grad.addColorStop(0, `rgba(${RED}, 0)`);
      grad.addColorStop(0.85, `rgba(${RED}, 0.45)`);
      grad.addColorStop(1, `rgba(255, 140, 120, 0.8)`);
      ctx.beginPath();
      for (let x = tail; x <= head; x += 10) {
        let y = baseY + Math.sin(x / w * 6 + t * 0.4 + s.offset * 9) * h * 0.006;
        if (p) {
          const near = gauss((x - p.x) ** 2, 140) * gauss((baseY - p.y) ** 2, 120);
          y += Math.sign(baseY - p.y || 1) * near * 70;
        }
        if (x === tail) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = `rgba(${RED}, 0.8)`;
      ctx.shadowBlur = 8;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  };
}

const SCENES: Record<Exclude<BackgroundKind, "smoke">, () => Scene> = { eclipse, waves, dots, tiles, lines };

function CanvasScene({ kind, className }: { kind: Exclude<BackgroundKind, "smoke">; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const draw = SCENES[kind]();
    let w = 0, h = 0;
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      w = el.clientWidth;
      h = el.clientHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    window.addEventListener("resize", size);
    const readTheme = () => { theme.light = document.documentElement.classList.contains("light"); };
    readTheme();
    const themeWatch = new MutationObserver(readTheme);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const t0 = performance.now();
    let pointer: Pointer = null;
    const onPointer = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top, at = performance.now() - t0;
      pointer = pointer ? { x, y, vx: x - pointer.x, vy: y - pointer.y, at } : { x, y, vx: 0, vy: 0, at };
    };
    window.addEventListener("pointermove", onPointer);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const frame = (now: number) => {
      draw(ctx, w, h, still ? 60 : (now - t0) / 1000, pointer);
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onVisible = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !still) raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelAnimationFrame(raf);
      themeWatch.disconnect();
      window.removeEventListener("resize", size);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [kind]);

  return <canvas ref={canvas} className={className} aria-hidden />;
}

/** Shows the background named by ?bg= (eclipse by default). */
export function HeroBackground({ className }: { className?: string }) {
  const asked = useSearchParams().get("bg") as BackgroundKind | null;
  const kind = asked && KINDS.includes(asked) ? asked : "eclipse";
  return kind === "smoke" ? <RedFlow className={className} /> : <CanvasScene key={kind} kind={kind} className={className} />;
}
