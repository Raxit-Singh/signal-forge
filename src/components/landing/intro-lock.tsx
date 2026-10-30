"use client";

import { useEffect } from "react";

// The opening plays out before the page can be scrolled: until the answer is sharp and the bar and eclipse are in.
// --answer (3.9s) + the slowest word of the answer (1.6s, plus its 0.4s stagger) — keep in step with landing.css.
const INTRO_MS = 5900;

/** Holds the page at the top while the opening plays. Skipped for reduced motion, which shows the finished page. */
export function IntroLock() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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
