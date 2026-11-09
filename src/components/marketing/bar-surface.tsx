"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Makes the top bar solid only while plain black page scrolls under it, where text would otherwise show through and
 * clash with its links: on the landing from the pricing on, on other pages once scrolled. It stays transparent over
 * the landing's first screen and story, and at the top of other pages. Over the red footer it takes the red, which
 * looks the same as transparent but keeps the footer's words from running under the logo.
 */
export function BarSurface() {
  const path = usePathname();
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>("header.hx-bar");
    if (!bar) return;
    let queued = 0;
    const update = () => {
      queued = 0;
      const h = bar.offsetHeight;
      const pricing = document.querySelector("#pricing");
      const under = pricing ? pricing.getBoundingClientRect().top <= h : scrollY > 8;
      // The footer's red starts at the middle of its big name.
      const name = document.querySelector(".hx-end-name")?.getBoundingClientRect();
      const red = !!name && name.top + name.height / 2 <= h;
      bar.classList.toggle("is-solid", under && !red);
      bar.classList.toggle("is-red", red);
    };
    const queue = () => { queued ||= requestAnimationFrame(update); };
    update();
    addEventListener("scroll", queue, { passive: true });
    addEventListener("resize", queue);
    return () => {
      cancelAnimationFrame(queued);
      removeEventListener("scroll", queue);
      removeEventListener("resize", queue);
    };
  }, [path]);
  return null;
}
