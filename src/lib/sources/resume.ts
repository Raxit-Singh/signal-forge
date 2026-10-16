// Resumable collection (pure). A search window that returns more results than
// one job may read leaves a GAP — the part of the window not yet read — which
// later jobs continue, instead of re-reading the newest results forever:
//
//   * range sources: the gap is [window start, oldest result read]; the next job
//     searches that narrower range (time-window splitting). Whole-day date filters
//     (X, Facebook) can't split inside a day: a day with more results than a job can
//     read keeps its newest part and the rest of that day is reported as lost.
//   * page sources: the gap remembers the next page offset of the same query,
//     up to the provider's page limit.
//   * other sources: nothing beyond one call is reachable; the unread part is
//     reported as lost (partial coverage), never as complete.
//
// A gap that stops making progress (stalls twice) is closed and reported.

import type { CollectionProfile } from "./collection-profile.ts";
import type { CandidateMention, SearchWindow } from "./types.ts";

export interface Gap {
  since: string;
  until: string;
  /** Next page offset (page-resumable sources). */
  page?: number;
  stalls?: number;
}

export interface LostWindow {
  since: Date;
  until: Date;
  reason: string;
}

export interface ResumeDecision {
  /** What remains to be read (null = the window is done or can't be continued). */
  gap: Gap | null;
  /** Part of the window that can't be read at all (recorded as a partial coverage window). */
  lost: LostWindow | null;
  /** The run reached the start of its window (or the provider proved there's nothing more). */
  complete: boolean;
}

const DAY = 86_400_000;
const utcDayStart = (t: number) => Math.floor(t / DAY) * DAY;

/** Oldest real publication time among results (estimated dates don't count). */
export function oldestPublished(items: CandidateMention[]): Date | null {
  let min = Infinity;
  for (const i of items) {
    if (i.publishedAtEstimated) continue;
    const t = i.publishedAt.getTime();
    if (Number.isFinite(t) && t < min) min = t;
  }
  return Number.isFinite(min) ? new Date(min) : null;
}

/** Minutes between the oldest result and the window end (how much time the results covered). */
export function observedSpanMinutes(items: CandidateMention[], window: SearchWindow): number | null {
  const oldest = oldestPublished(items);
  if (!oldest) return null;
  return Math.max(0, Math.round((window.until.getTime() - Math.max(oldest.getTime(), window.since.getTime())) / 60_000));
}

export function decideResume(opts: {
  profile: CollectionProfile;
  window: SearchWindow;
  items: CandidateMention[];
  /** The search ended with results left (page cap hit, has_next_page...). */
  saturated: boolean;
  /** Pages read in this run (page sources). */
  pagesRead: number;
  /** The gap this run worked on, if it was a continuation. */
  previous: Gap | null;
  platformName: string;
}): ResumeDecision {
  const { profile: p, window: w } = opts;
  if (!opts.saturated) return { gap: null, lost: null, complete: true };
  const stalls = opts.previous?.stalls ?? 0;

  if (p.resume === "range") {
    const oldest = oldestPublished(opts.items);
    if (!oldest || oldest.getTime() <= w.since.getTime()) return { gap: null, lost: null, complete: true };
    let until = oldest.getTime() + 1000; // results at the boundary second repeat; they're de-duplicated
    let lost: LostWindow | null = null;
    if (p.dayGranularity) {
      // The next request can only end at a whole day. If the oldest result is in the window's last
      // day, that day can't be narrowed: keep moving back a day and report the rest of it as lost.
      const lastDay = utcDayStart(w.until.getTime() - 1);
      if (utcDayStart(oldest.getTime()) >= lastDay) {
        const dayStart = Math.max(utcDayStart(oldest.getTime()), w.since.getTime());
        lost = {
          since: new Date(dayStart), until: oldest,
          reason: `${opts.platformName} filters by whole days and had more results on ${new Date(dayStart).toISOString().slice(0, 10)} than can be read; the oldest of that day were not reached.`,
        };
        until = dayStart;
      }
    }
    if (until <= w.since.getTime()) return { gap: null, lost, complete: lost === null };
    const progressed = !opts.previous || until < new Date(opts.previous.until).getTime();
    const nextStalls = progressed ? 0 : stalls + 1;
    if (nextStalls >= 2) {
      return {
        gap: null, complete: false,
        lost: { since: w.since, until: new Date(until), reason: `${opts.platformName} kept returning the same results; the rest of this window could not be reached.` },
      };
    }
    return { gap: { since: w.since.toISOString(), until: new Date(until).toISOString(), stalls: nextStalls }, lost, complete: false };
  }

  if (p.resume === "page") {
    const next = (opts.previous?.page ?? 1) + Math.max(1, opts.pagesRead);
    if (p.providerMaxPages !== null && next > p.providerMaxPages) {
      const oldest = oldestPublished(opts.items);
      return {
        gap: null, complete: false,
        lost: {
          since: w.since, until: oldest && oldest > w.since ? oldest : w.until,
          reason: `${opts.platformName} returns at most ${p.providerMaxPages} pages per search; older results in this window are beyond its reach.`,
        },
      };
    }
    return { gap: { since: w.since.toISOString(), until: w.until.toISOString(), page: next, stalls }, lost: null, complete: false };
  }

  const oldest = oldestPublished(opts.items);
  return {
    gap: null, complete: false,
    lost: {
      since: w.since, until: oldest && oldest > w.since && oldest < w.until ? oldest : w.until,
      reason: p.sortNewest
        ? `${opts.platformName} only exposes its newest results for a search; older ones in this window can't be reached.`
        : `${opts.platformName} search is ranked by relevance, so it can't guarantee every result in this window.`,
    },
  };
}
