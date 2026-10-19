"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRelative, formatTime } from "@/lib/format";

// The viewer's time zone for every timestamp on the page. The server reads it
// from the sf_tz cookie and passes it down, so server and browser render the
// same text; <TimeZoneSync> sets the cookie from the browser on first visit
// (or after travelling) and refreshes once.

const TimeZoneContext = createContext("UTC");

export function TimeZoneProvider({ tz, children }: { tz: string; children: React.ReactNode }) {
  return (
    <TimeZoneContext.Provider value={tz}>
      <TimeZoneSync current={tz} />
      {children}
    </TimeZoneContext.Provider>
  );
}

export const useTimeZone = () => useContext(TimeZoneContext);

/** Remembers the viewer's time zone (cookie) so times and day buckets match their clock. */
export function TimeZoneSync({ current }: { current: string }) {
  const router = useRouter();
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz !== current) {
      document.cookie = `sf_tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    }
  }, [current, router]);
  return null;
}

/** A timestamp in the viewer's time zone. */
export function LocalTime({ value, dateOnly, className }: { value: string | Date; dateOnly?: boolean; className?: string }) {
  const tz = useTimeZone();
  const iso = typeof value === "string" ? value : value.toISOString();
  return <time dateTime={iso} className={className}>{formatTime(value, tz, { dateOnly })}</time>;
}

/**
 * "in 4 minutes" / "12 minutes ago" that keeps counting without a reload; shows
 * `dueLabel` once a future time has passed.
 */
export function RelativeTime({ value, dueLabel }: { value: string; dueLabel?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const at = new Date(value).getTime();
  const text = dueLabel && at <= now ? dueLabel : formatRelative(new Date(at), new Date(now));
  return <time dateTime={value} suppressHydrationWarning>{text}</time>;
}

/** Re-renders the page from the server every `everyMs` while the tab is visible (progress that has no live event). */
export function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [everyMs, router]);
  return null;
}
