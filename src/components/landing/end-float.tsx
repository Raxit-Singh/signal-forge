"use client";

import { useEffect, useRef } from "react";

/**
 * The footer's name floats up into place as the footer scrolls in: it starts a little low and rises, easing after the
 * scroll, to rest on the red block's edge. The split colour (red above the edge, ink below) follows the edge as it
 * moves: --lift shifts the word's gradient, and the mark's gradient stops move with it.
 */
export function EndFloat() {
  const probe = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const footer = probe.current?.closest("footer");
    const name = footer?.querySelector<HTMLElement>(".hx-end-name");
    const mark = name?.querySelector<SVGSVGElement>(".hx-end-mark");
    const stops = footer ? [...footer.querySelectorAll<SVGStopElement>("#hx-end-fill stop")] : [];
    if (!footer || !name) return;

    const FOLLOW_MS = 140;
    let shown = -1;
    let queued = 0;
    let last = 0;
    const target = () => {
      const top = footer.getBoundingClientRect().top;
      // 0 as the footer's top enters at the bottom of the screen, 1 once it is 55% of the way up.
      const q = Math.min(1, Math.max(0, (innerHeight - top) / (innerHeight * 0.55)));
      const e = 1 - (1 - q) ** 3;
      return (1 - e) * name.offsetHeight * 0.32;
    };
    const frame = (now: number) => {
      queued = 0;
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      const goal = target();
      shown = shown < 0 ? goal : shown + (goal - shown) * (1 - Math.exp(-dt / FOLLOW_MS));
      if (Math.abs(goal - shown) < 0.3) shown = goal;
      // The name sits `shown` px low; the block's edge is then `shown` px above the name's middle.
      name.style.transform = shown ? `translateY(${shown.toFixed(2)}px)` : "";
      name.style.setProperty("--lift", `${(-shown).toFixed(2)}px`);
      if (mark && stops.length) {
        const h = mark.getBoundingClientRect().height || 1;
        const off = Math.min(1, Math.max(0, 0.5 - shown / h)).toFixed(4);
        for (const s of stops) s.setAttribute("offset", off);
      }
      if (shown !== goal) queued = requestAnimationFrame(frame);
      else last = 0;
    };
    const queue = () => { queued ||= requestAnimationFrame(frame); };
    queue();
    addEventListener("scroll", queue, { passive: true });
    addEventListener("resize", queue);
    return () => {
      cancelAnimationFrame(queued);
      removeEventListener("scroll", queue);
      removeEventListener("resize", queue);
      name.style.transform = "";
      name.style.removeProperty("--lift");
      for (const s of stops) s.setAttribute("offset", "0.5");
    };
  }, []);
  return <span ref={probe} hidden />;
}
