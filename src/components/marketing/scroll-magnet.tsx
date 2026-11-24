"use client";

import { useEffect } from "react";

/**
 * Gentle scroll snapping to the points where the page's scroll-played scenes are at rest, so a visitor doesn't have
 * to stop the scroll at exactly the right place to see one play. When the scroll settles near a point, the page
 * glides the rest of the way there.
 *
 * Points come from `data-snap` on any element: space-separated offsets in screen heights from the element's top
 * (`data-snap="0"` brings its top to the top of the screen, `"-0.12"` to 12% down, `"1.2"` a screen and a fifth into
 * a tall track). `data-snap-radius` (screen heights, default 0.3) is how near counts.
 *
 * `data-snap-zone` makes a tall scroll-played track hold no in-between places: while the screen is inside it, the
 * page always goes on to the track's next point the way it was scrolling (or back, for a small overshoot), however
 * far that is, so a scene is never left half played.
 *
 * `data-snap-slow` marks stretches a glide passes through more slowly (see slowRanges below). `data-snap-free` marks
 * stretches left entirely to the visitor's own scroll: stopping inside one never glides (pairs of from, to).
 *
 * Moving away from a point, only a small overshoot is pulled back, so the page never holds on to someone scrolling
 * past. Off for reduced motion, while the page can't scroll (the landing's opening) and while a finger or the
 * scrollbar is held.
 */
export function ScrollMagnet() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const SETTLE_MS = 160;
    const AWAY = 0.3; // screen heights pulled back when the scroll overshoots a point
    // The glide is paced like a calm scroll, not the browser's quick smooth scroll: the scenes on the way are scrubbed
    // by the scroll, and a fast glide would play them in a blur.
    const MS_PER_SCREEN = 1100;
    const MIN_MS = 600;
    const MAX_MS = 8000;
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    let timer = 0;
    let gliding = false;
    let frame = 0;
    let held = false;
    let movedWhileHeld = false;
    let lastY = scrollY;
    let dir = 0;

    const points = () => {
      const out: { y: number; r: number }[] = [];
      const h = innerHeight;
      document.querySelectorAll<HTMLElement>("[data-snap]").forEach((el) => {
        const box = el.getBoundingClientRect();
        const top = box.top + scrollY;
        let r = (Number(el.dataset.snapRadius) || 0.3) * h;
        // Inside a zone, every point of it is in reach; outside it, its points are ordinary.
        if (el.hasAttribute("data-snap-zone") && scrollY >= top - 2 && scrollY <= top + box.height - h + 2) r = Infinity;
        for (const v of (el.dataset.snap ?? "").split(/\s+/)) {
          const n = Number(v);
          if (v && Number.isFinite(n)) out.push({ y: Math.round(top + n * h), r });
        }
      });
      return out;
    };

    // Stretches a glide goes through more slowly, from `data-snap-slow` on the snap element: triples of from, to (screen
    // heights from its top, like data-snap) and how many times slower.
    const slowRanges = () => {
      const out: { a: number; b: number; k: number }[] = [];
      document.querySelectorAll<HTMLElement>("[data-snap-slow]").forEach((el) => {
        const top = el.getBoundingClientRect().top + scrollY;
        const n = (el.dataset.snapSlow ?? "").split(/\s+/).map(Number);
        for (let i = 0; i + 2 < n.length; i += 3) {
          const [a, b, k] = [n[i]!, n[i + 1]!, n[i + 2]!];
          if ([a, b, k].every(Number.isFinite) && k > 0) out.push({ a: top + a * innerHeight, b: top + b * innerHeight, k });
        }
      });
      return out;
    };

    // Inside a free stretch the page stays where the visitor leaves it.
    const inFree = () => {
      let free = false;
      document.querySelectorAll<HTMLElement>("[data-snap-free]").forEach((el) => {
        const top = el.getBoundingClientRect().top + scrollY;
        const n = (el.dataset.snapFree ?? "").split(/\s+/).map(Number);
        for (let i = 0; i + 1 < n.length; i += 2) {
          const a = top + n[i]! * innerHeight, b = top + n[i + 1]! * innerHeight;
          if (scrollY > a + 2 && scrollY < b - 2) free = true;
        }
      });
      return free;
    };

    const stopGlide = () => { gliding = false; cancelAnimationFrame(frame); };

    const glide = (to: number) => {
      const from = scrollY;
      // The path in pieces, each with its slowness; the glide spends time in proportion to distance × slowness.
      const lo = Math.min(from, to), hi = Math.max(from, to);
      const cuts = [lo, hi];
      const ranges = slowRanges();
      for (const r of ranges) for (const c of [r.a, r.b]) if (c > lo && c < hi) cuts.push(c);
      cuts.sort((x, y) => x - y);
      const weight = (y: number) => ranges.reduce((k, r) => (y >= r.a && y <= r.b ? Math.max(k, r.k) : k), 1);
      let pieces = cuts.slice(1).map((c, i) => ({ a: cuts[i]!, b: c, k: weight((cuts[i]! + c) / 2) }));
      if (to < from) pieces = pieces.reverse().map((q) => ({ a: q.b, b: q.a, k: q.k }));
      const cost = pieces.reduce((sum, q) => sum + Math.abs(q.b - q.a) * q.k, 0);
      const at = (c: number) => {
        for (const q of pieces) {
          const len = Math.abs(q.b - q.a) * q.k;
          if (c <= len) return q.a + (q.b - q.a) * (len ? c / len : 1);
          c -= len;
        }
        return to;
      };
      const ms = Math.min(MAX_MS, Math.max(MIN_MS, (cost / innerHeight) * MS_PER_SCREEN));
      const t0 = performance.now();
      gliding = true;
      const step = (now: number) => {
        if (!gliding) return;
        const t = Math.min(1, (now - t0) / ms);
        window.scrollTo({ top: t < 1 ? at(cost * ease(t)) : to, behavior: "instant" });
        lastY = scrollY;
        if (t < 1) frame = requestAnimationFrame(step);
        else gliding = false;
      };
      frame = requestAnimationFrame(step);
    };

    const settle = () => {
      if (held || gliding) return;
      const root = document.documentElement;
      if (getComputedStyle(root).overflow === "hidden" || getComputedStyle(document.body).overflow === "hidden") return;
      if (inFree()) return;
      const max = root.scrollHeight - innerHeight;
      // A small overshoot goes back to the point just passed; otherwise on to the nearest point the way the page was
      // going (either way, when it wasn't going anywhere).
      let back: { y: number; d: number } | null = null;
      let on: { y: number; d: number } | null = null;
      for (const p of points()) {
        const y = Math.min(Math.max(0, p.y), max);
        const d = y - scrollY;
        if (Math.abs(d) <= 2) return; // already at rest on a point
        const behind = dir !== 0 && Math.sign(d) === -dir;
        if (behind) {
          if (Math.abs(d) <= Math.min(p.r, AWAY * innerHeight) && (!back || Math.abs(d) < Math.abs(back.d))) back = { y, d };
        } else if (Math.abs(d) <= p.r && (!on || Math.abs(d) < Math.abs(on.d))) on = { y, d };
      }
      const best = back ?? on;
      if (!best) return;
      glide(best.y);
    };

    const scrolled = () => {
      const y = scrollY;
      if (y !== lastY) dir = Math.sign(y - lastY);
      lastY = y;
      if (held) movedWhileHeld = true;
      if (gliding) return;
      clearTimeout(timer);
      timer = window.setTimeout(settle, SETTLE_MS);
    };
    // Any input of the visitor's own takes over from a glide at once.
    const input = () => stopGlide();
    const down = () => { held = true; movedWhileHeld = false; stopGlide(); };
    // Let go after dragging the page or the scrollbar: settle as after any scroll. A plain click doesn't.
    const up = () => {
      if (!held) return;
      held = false;
      if (!movedWhileHeld) return;
      clearTimeout(timer);
      timer = window.setTimeout(settle, SETTLE_MS);
    };
    // Jumps to a section (links, the address) go straight there; don't pull them anywhere.
    const jumped = () => { clearTimeout(timer); stopGlide(); };

    addEventListener("scroll", scrolled, { passive: true });
    addEventListener("wheel", input, { passive: true });
    addEventListener("keydown", input);
    addEventListener("touchstart", down, { passive: true });
    addEventListener("touchend", up);
    addEventListener("touchcancel", up);
    addEventListener("pointerdown", down);
    addEventListener("pointerup", up);
    addEventListener("hx:jump", jumped);
    addEventListener("hashchange", jumped);
    return () => {
      clearTimeout(timer); stopGlide();
      removeEventListener("scroll", scrolled);
      removeEventListener("wheel", input);
      removeEventListener("keydown", input);
      removeEventListener("touchstart", down);
      removeEventListener("touchend", up);
      removeEventListener("touchcancel", up);
      removeEventListener("pointerdown", down);
      removeEventListener("pointerup", up);
      removeEventListener("hx:jump", jumped);
      removeEventListener("hashchange", jumped);
    };
  }, []);
  return null;
}
