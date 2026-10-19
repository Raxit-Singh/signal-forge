import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { isValidTimeZone } from "@/lib/analytics/buzz";

export const TIME_ZONE_COOKIE = "sf_tz";

/** The viewer's IANA time zone, remembered by <TimeZoneSync> in a cookie; UTC until the browser has reported it. */
export const getTimeZone = cache(async (): Promise<string> => {
  const tz = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
  return tz && isValidTimeZone(tz) ? tz : "UTC";
});
