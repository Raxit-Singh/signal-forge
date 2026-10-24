"use client";

import { useEffect, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import NumberFlow, { type Format } from "@number-flow/react";

// Shared motion vocabulary. One curve, short durations, transform + opacity only.
// MotionProvider honours the OS "reduce motion" setting: movement is dropped, fades stay.

/** Strong ease-out (the same curve as --ease-out in globals.css). */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** Spring for things that glide between positions (active indicators). */
export const GLIDE = { type: "spring", duration: 0.35, bounce: 0.12 } as const;

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={{ duration: 0.3, ease: EASE_OUT }}>{children}</MotionConfig>;
}

/**
 * Rises into place on first paint: 8px and a fade, 340ms, delayed by `index` × 45ms so a grid
 * of panels settles in order. Pure CSS, so it never waits for hydration; live refreshes keep the
 * element mounted and don't replay it.
 */
export function Rise({ index = 0, className, style, children, ...props }: { index?: number } & React.ComponentProps<"div">) {
  return (
    <div className={`rise ${className ?? ""}`} style={{ ...style, ["--d" as string]: `${Math.min(index, 10) * 45}ms` }} {...props}>
      {children}
    </div>
  );
}

/** A horizontal bar that grows from its start edge on first paint (scaleX, never width; CSS). */
export function GrowBar({ value, color, delay = 0, className = "h-1.5" }: { value: number; color: string; delay?: number; className?: string }) {
  return (
    <span className={`block overflow-hidden rounded-full bg-muted ${className}`} aria-hidden>
      <span
        className="grow-x block h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color, ["--d" as string]: `${Math.round(delay * 1000)}ms` }}
      />
    </span>
  );
}

/**
 * A number that's correct from the first paint (server-rendered value), counts up from zero once
 * the page is interactive, and rolls digit by digit whenever it changes later (live updates).
 * Reduced motion: no count, values just change.
 */
export function CountUp({ value, format, suffix, className }: { value: number; format?: Format; suffix?: string; className?: string }) {
  const [shown, setShown] = useState(value);
  const [animated, setAnimated] = useState(true);
  const counted = useRef(false);
  useEffect(() => {
    let a = 0, b = 0;
    if (!counted.current && value !== 0 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Marked as counted only when the count actually starts, so React's double effect run in
      // development (or an interrupted first frame) can't skip it.
      a = requestAnimationFrame(() => {
        counted.current = true;
        setAnimated(false);
        setShown(0);
        b = requestAnimationFrame(() => { setAnimated(true); setShown(value); });
      });
    } else {
      counted.current = true;
      a = requestAnimationFrame(() => { setAnimated(true); setShown(value); });
    }
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [value]);
  return (
    <NumberFlow
      value={shown}
      animated={animated}
      format={format}
      suffix={suffix}
      className={className}
      style={{ fontVariantNumeric: "tabular-nums" }}
      transformTiming={{ duration: 900, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
      spinTiming={{ duration: 900, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
      opacityTiming={{ duration: 350, easing: "ease-out" }}
    />
  );
}
