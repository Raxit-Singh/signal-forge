"use client";

import { createContext, useContext, useEffect } from "react";
import { useRouter } from "next/navigation";
import { formatTime } from "@/lib/format";

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
