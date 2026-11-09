"use client";

import { useEffect } from "react";

// The opening plays out before the page can be scrolled: until the answer is sharp and the bar and eclipse are in.
// --answer (1.7s) + the slowest word of the answer (1.2s, plus its 0.3s stagger) — keep in step with landing.css.
const INTRO_MS = 3300;

/**
 * Holds the page at the top while the opening plays. Skipped for reduced motion, which shows the finished page, and
 * for a link to a section (/#pricing, /#faq): that visitor goes straight there, and the bar shouldn't wait for an
 * opening they aren't watching.
 */
export function IntroLock() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (location.hash.length > 1) {
      document.querySelector<HTMLElement>(".hx")?.style.setProperty("--answer", "0ms");
      return;
    }
    // A reload mid-page starts again at the top, so the opening is always seen from the start.
    history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    const root = document.documentElement;
    root.style.scrollbarGutter = "stable"; // where scrollbars take space, the page does not jump when it unlocks
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden"; // iOS Safari needs both
    const release = () => {
      root.style.overflow = "";
      document.body.style.overflow = "";
    };
    const timer = window.setTimeout(release, INTRO_MS);
    return () => {
      clearTimeout(timer);
      release();
    };
  }, []);
  return null;
}
