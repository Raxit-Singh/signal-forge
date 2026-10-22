// When a failed check of a search runs again (pure; unit-tested).

import { nextRunAt } from "./adaptive.ts";
import type { SourceError } from "./errors.ts";

/**
 * When a failed check runs again. Only transient failures are retried sooner: a refused budget
 * waits for the normal interval, and an answer the platform will keep giving ("not found" — e.g.
 * the business has no Trustpilot page; a rejected search) waits a day or a week instead of being
 * re-bought every few minutes (paid sources bill a 404).
 */
export function failureRetry(err: SourceError, intervalMinutes: number, failures: number, platformName: string, now: Date): { next: Date; reason: string } {
  if (err.kind === "budget") return { next: nextRunAt(now, intervalMinutes, 0), reason: "Paid-source budget reached: checked again at the normal interval" };
  if (err.kind === "bad_request" && err.status === 404) {
    return { next: new Date(now.getTime() + 7 * 24 * 3_600_000), reason: `Not found on ${platformName}: checked again in a week` };
  }
  if (err.kind === "bad_request") {
    return { next: new Date(now.getTime() + Math.max(intervalMinutes, 24 * 60) * 60_000), reason: `${platformName} rejected this search: checked again in a day` };
  }
  return { next: nextRunAt(now, intervalMinutes, failures), reason: `Retrying sooner after ${failures} failed check${failures === 1 ? "" : "s"}` };
}

