"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

export function ThemeProvider(props: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />;
}

/**
 * Switches the theme with the new one spreading out in a circle from the control that was pressed, the same way in
 * both directions (a view transition of the whole page). While it switches, every other transition on the page is
 * held off (globals.css, .theme-switching), so the new picture is complete from the first frame and nothing fades
 * on its own underneath. Without view transitions, with reduced motion, or when the look doesn't change, it just switches.
 */
export function useThemeSwitch() {
  const { setTheme, resolvedTheme } = useTheme();
  return (next: string, from?: Element | null) => {
    const shown = next === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : next;
    const root = document.documentElement;
    if (shown === resolvedTheme || !document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTheme(next);
      return;
    }
    // From the control that was pressed; failing that, from the theme button in the top bar, never from nowhere.
    const box = (from ?? document.querySelector(".hx-theme"))?.getBoundingClientRect();
    const x = box ? box.left + box.width / 2 : innerWidth / 2;
    const y = box ? box.top + box.height / 2 : 0;
    root.classList.add("theme-switching");
    const transition = document.startViewTransition(() => {
      // Applied here, synchronously, so the transition's "after" picture is the new theme; next-themes then saves it.
      root.classList.remove("light", "dark");
      root.classList.add(shown);
      root.style.colorScheme = shown;
      setTheme(next);
      // Canvases (the eclipse, embers, dots) only repaint on their next frame; this has them repaint now.
      window.dispatchEvent(new Event("hx:theme"));
    });
    transition.ready.then(() => {
      const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        // One steady speed from the toggle to the far corner: no slow start, no slow finish.
        { duration: 700, easing: "linear", pseudoElement: "::view-transition-new(root)" },
      );
    }).catch(() => {});
    transition.finished.finally(() => root.classList.remove("theme-switching"));
  };
}

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

const noopSubscribe = () => () => {};

/** Segmented control; renders a stable placeholder until mounted to avoid hydration mismatch. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme } = useTheme();
  const switchTheme = useThemeSwitch();
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return (
    <div role="radiogroup" aria-label="Theme" className={cn("inline-flex rounded-md border p-0.5", className)}>
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={(e) => switchTheme(value, e.currentTarget)}
            className={cn(
              "inline-flex size-6 items-center justify-center rounded text-muted-foreground",
              active && "bg-muted text-foreground",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
