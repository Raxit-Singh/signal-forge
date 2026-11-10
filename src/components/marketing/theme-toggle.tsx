"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { useThemeSwitch } from "@/components/theme-provider";

const noop = () => () => {};

/** Light or dark for the public pages; the same setting as the app's (Settings → Account), saved by next-themes. */
export function ThemeToggle() {
  const { resolvedTheme } = useTheme();
  const switchTheme = useThemeSwitch();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const dark = !mounted || resolvedTheme !== "light";
  return (
    <button type="button" className="hx-theme" data-dark={dark} onClick={(e) => switchTheme(dark ? "light" : "dark", e.currentTarget)}
      aria-label={dark ? "Switch to light" : "Switch to dark"} title={dark ? "Light" : "Dark"}>
      {/* Both drawn; the one not in use is turned away and shrunk (landing.css, .hx-theme). */}
      <svg className="hx-theme-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg className="hx-theme-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      </svg>
    </button>
  );
}
