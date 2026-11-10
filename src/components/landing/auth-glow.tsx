"use client";

import { useEffect, useRef } from "react";

/**
 * The sign-in pages' light, behind both halves alike: a red glow rising from the bottom of the screen and small embers
 * drifting up out of it, swaying and burning out as they climb. Reduced motion keeps the glow and drops the embers.
 */
export function AuthGlow() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d");
    if (!ctx || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let w = 0, h = 0;
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      w = el.clientWidth; h = el.clientHeight;
      el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    addEventListener("resize", size);
    const light = () => document.documentElement.classList.contains("light");

    type Ember = { x: number; y: number; vy: number; sway: number; seed: number; age: number; life: number; size: number; hue: number };
    const embers: Ember[] = [];
    const MAX = 80;
    let last = 0, owed = 0, raf = 0;

    const frame = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      if (w && h) {
        // About ten a second, most of them from the middle of the bottom edge, where the light is strongest.
        owed += dt * 10;
        while (owed >= 1 && embers.length < MAX) {
          owed -= 1;
          const u = (Math.random() + Math.random() + Math.random()) / 3;
          embers.push({
            x: u * w, y: h + 6, vy: 22 + Math.random() * 46, sway: 6 + Math.random() * 18, seed: Math.random() * 100,
            age: 0, life: 3.5 + Math.random() * 4.5, size: 0.45 + Math.random() * 0.8, hue: 4 + Math.random() * 28,
          });
        }
        if (owed > 1) owed = 1;
        ctx.clearRect(0, 0, w, h);
        const glowMode = light() ? "source-over" : "lighter";
        ctx.globalCompositeOperation = glowMode;
        for (let i = embers.length - 1; i >= 0; i--) {
          const e = embers[i]!;
          e.age += dt;
          if (e.age > e.life) { embers.splice(i, 1); continue; }
          e.y -= e.vy * dt;
          const k = e.age / e.life;
          const x = e.x + Math.sin(e.age * 1.4 + e.seed) * e.sway * k;
          // Bright as it leaves the glow, fading out toward the end of its climb.
          const a = Math.min(1, e.age / 0.4) * (1 - k) ** 1.4;
          const r = e.size * (1 - k * 0.5);
          ctx.fillStyle = `hsla(${e.hue}, 100%, ${light() ? 50 : 62}%, ${a * 0.25})`;
          ctx.beginPath(); ctx.arc(x, e.y, r * 2.4, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = `hsla(${e.hue}, 100%, ${light() ? 48 : 70}%, ${a})`;
          ctx.beginPath(); ctx.arc(x, e.y, r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onVisible = () => {
      cancelAnimationFrame(raf);
      last = 0;
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", size);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <div className="hx-auth-glow pointer-events-none fixed inset-0 z-0" aria-hidden>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
