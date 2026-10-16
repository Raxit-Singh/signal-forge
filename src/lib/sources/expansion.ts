// Comment Expansion Engine (pure). Platforms without global comment search
// (X replies, TikTok, Instagram, Facebook, DEV) only show comments for posts we
// ask about, and each ask may cost money. So:
//   1. candidates are relevant posts/videos from this run
//   2. each is scored: relevance × discussion size × recency
//   3. posts already expanded are revisited only when the discussion grew
//   4. at most N parents per run (more on busier platforms), one page each
// Comments are then filtered locally by the normal relevance rules.

import type { ExpansionParent } from "./types.ts";

export interface ExpansionCandidate {
  parent: ExpansionParent;
  /** 0..1 relevance of the parent to the product. */
  relevance: number;
}

export interface ExpansionHistory {
  lastExpandedAt: Date;
  commentCountAtLast: number;
}

export interface ExpansionOptions {
  /** Most parents to expand this run (see expansionsPerRun in adaptive.ts). */
  maxParents: number;
  now: Date;
  /** Parents with fewer comments aren't worth a request. */
  minComments?: number;
  /** Don't revisit a parent sooner than this. */
  revisitAfterHours?: number;
}

export interface ExpansionDecision {
  selected: ExpansionParent[];
  skipped: Array<{ externalId: string; reason: "few_comments" | "recently_expanded" | "no_new_comments" | "lower_priority" }>;
}

export function expansionPriority(c: ExpansionCandidate, now: Date): number {
  const ageDays = (now.getTime() - c.parent.publishedAt.getTime()) / 86_400_000;
  const recency = ageDays <= 3 ? 1 : ageDays <= 14 ? 0.6 : 0.3;
  return c.relevance * Math.log2(2 + c.parent.commentCount) * recency;
}

export function selectExpansions(
  candidates: ExpansionCandidate[],
  history: Map<string, ExpansionHistory>,
  opts: ExpansionOptions,
): ExpansionDecision {
  const minComments = opts.minComments ?? 3;
  const revisitMs = (opts.revisitAfterHours ?? 6) * 3_600_000;
  const skipped: ExpansionDecision["skipped"] = [];
  const eligible: ExpansionCandidate[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    if (seen.has(c.parent.externalId)) continue;
    seen.add(c.parent.externalId);
    if (c.parent.commentCount < minComments) {
      skipped.push({ externalId: c.parent.externalId, reason: "few_comments" });
      continue;
    }
    const h = history.get(c.parent.externalId);
    if (h) {
      if (opts.now.getTime() - h.lastExpandedAt.getTime() < revisitMs) {
        skipped.push({ externalId: c.parent.externalId, reason: "recently_expanded" });
        continue;
      }
      const growth = c.parent.commentCount - h.commentCountAtLast;
      if (growth < Math.max(5, Math.ceil(h.commentCountAtLast * 0.25))) {
        skipped.push({ externalId: c.parent.externalId, reason: "no_new_comments" });
        continue;
      }
    }
    eligible.push(c);
  }

  eligible.sort((a, b) => expansionPriority(b, opts.now) - expansionPriority(a, opts.now)
    || a.parent.externalId.localeCompare(b.parent.externalId));
  const max = Math.max(0, opts.maxParents);
  for (const c of eligible.slice(max)) skipped.push({ externalId: c.parent.externalId, reason: "lower_priority" });
  return { selected: eligible.slice(0, max).map((c) => c.parent), skipped };
}
