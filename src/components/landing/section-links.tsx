"use client";

import { useEffect } from "react";

/** Tells the landing's scroll-driven pieces to be where the page now is at once, rather than play their way there. */
function jumped() {
  dispatchEvent(new Event("hx:jump"));
}

/**
 * Links to a section of this page (Pricing, FAQ), from the top bar, the phone menu or the footer: they go straight
 * there, every time. Without this, a second click on the same link did nothing (the address doesn't change, so neither
 * the browser nor Next scrolls), and the logo played its flight back into the bar on the way down.
 * Arriving from another page with a section in the address (/#pricing) is handled the same way once the page is in.
 */
export function SectionLinks() {
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) return;
      const section = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (!section) return;
      e.preventDefault(); // Next's Link sees this and leaves it to us
      jumped();
      section.scrollIntoView({ behavior: "instant", block: "start" });
      if (location.hash !== url.hash) history.pushState(history.state, "", url.hash);
      jumped(); // and again once the scroll has landed
    };
    document.addEventListener("click", click, true); // before Next's Link handles it
    // Arrived with a section in the address: the browser scrolls there after the page is in.
    let late = 0;
    if (location.hash) {
      jumped();
      late = window.setTimeout(jumped, 250);
    }
    addEventListener("hashchange", jumped);
    return () => {
      document.removeEventListener("click", click, true);
      removeEventListener("hashchange", jumped);
      clearTimeout(late);
    };
  }, []);
  return null;
}
