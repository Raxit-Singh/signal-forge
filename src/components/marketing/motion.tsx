"use client";

import { useEffect } from "react";

/**
 * The landing's motion on every other public page, once for the whole shell:
 * - `.hx-rise` rises in the first time it scrolls into view, including on pages reached by client navigation;
 * - cards in a `.hx-glow-group` light their border where the pointer is (--mx/--my on each `.hx-glow`), like the pricing cards.
 * Without script everything is simply visible; with reduced motion the CSS keeps it still.
 */
export function MarketingMotion() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("hx-js");
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -6% 0px" });
    const seen = new WeakSet<Element>();
    const scan = () => document.querySelectorAll(".hx-rise:not(.is-in)").forEach((el) => { if (!seen.has(el)) { seen.add(el); io.observe(el); } });
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });

    let group: Element | null = null;
    const track = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const g = (e.target as Element | null)?.closest?.(".hx-glow-group") ?? null;
      if (group && group !== g) group.classList.remove("is-lit");
      group = g;
      if (!g) return;
      g.classList.add("is-lit");
      g.querySelectorAll<HTMLElement>(".hx-glow").forEach((card) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - r.left}px`);
        card.style.setProperty("--my", `${e.clientY - r.top}px`);
      });
    };
    const away = (e: PointerEvent) => { if (!e.relatedTarget && group) { group.classList.remove("is-lit"); group = null; } };
    document.addEventListener("pointermove", track, { passive: true });
    document.addEventListener("pointerout", away);

    return () => {
      io.disconnect(); mo.disconnect();
      document.removeEventListener("pointermove", track); document.removeEventListener("pointerout", away);
      root.classList.remove("hx-js");
    };
  }, []);
  return null;
}
