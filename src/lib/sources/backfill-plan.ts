// Historical backfill planning (pure): which searches a historical request runs,
// how far back each source can reach, and a run's overall status.

import { collectionProfile, historySupport } from "./collection-profile.ts";
import { isPublicSource } from "./registry.ts";
import type { Gap } from "./resume.ts";
import type { PublicSourceId, SourceAdapter } from "./types.ts";

export type TaskStatus = "queued" | "searching" | "partial" | "paused" | "completed" | "unavailable";
export type RunStatus = TaskStatus | "canceled";

export type TaskCursor = Gap;

/** Overall status of a run from its tasks. */
export function runStatus(tasks: Array<{ status: TaskStatus }>): RunStatus {
  if (tasks.length === 0) return "unavailable";
  if (tasks.some((t) => t.status === "searching" || t.status === "queued")) return "searching";
  if (tasks.some((t) => t.status === "paused")) return "paused";
  if (tasks.every((t) => t.status === "unavailable")) return "unavailable";
  return tasks.some((t) => t.status === "partial" || t.status === "unavailable") ? "partial" : "completed";
}

export interface PlannedTask {
  query_id: string;
  platform: PublicSourceId;
  stream: string;
  status: TaskStatus;
  supported_since: string | null;
  cursor: TaskCursor | null;
  note: string | null;
}

/** One task per enabled query group, bounded by what each source can search back to. */
export function planBackfillTasks(
  queries: Array<{ id: string; provider: string; stream: string }>,
  range: { start: Date; end: Date },
  adapters: Record<PublicSourceId, SourceAdapter>,
  opts: { now: Date; paidEnabled: boolean },
): PlannedTask[] {
  const out: PlannedTask[] = [];
  for (const q of queries) {
    if (!isPublicSource(q.provider)) continue;
    const a = adapters[q.provider];
    const profile = collectionProfile(q.provider, q.stream);
    const support = historySupport(profile, range.start, opts.now);
    const base = { query_id: q.id, platform: q.provider, stream: q.stream };
    const setup = a.configured();
    if (!setup.ok) {
      out.push({ ...base, status: "unavailable", supported_since: null, cursor: null, note: `Not available on this server: ${setup.reason}` });
      continue;
    }
    if (support.supportedSince >= range.end) {
      out.push({ ...base, status: "unavailable", supported_since: support.supportedSince.toISOString(), cursor: null, note: support.note });
      continue;
    }
    const cursor: TaskCursor = { since: support.supportedSince.toISOString(), until: range.end.toISOString() };
    if (a.paid && !opts.paidEnabled) {
      out.push({ ...base, status: "paused", supported_since: support.supportedSince > range.start ? support.supportedSince.toISOString() : null, cursor, note: "Waiting: paid sources are switched off on this server." });
      continue;
    }
    out.push({
      ...base, status: "queued", cursor,
      supported_since: support.supportedSince > range.start ? support.supportedSince.toISOString() : null,
      note: support.full ? null : support.note,
    });
  }
  return out;
}

