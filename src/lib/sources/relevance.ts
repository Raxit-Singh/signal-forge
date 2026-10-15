// Stage 1–3 of the relevance pipeline (deterministic, no AI):
//   keyword match → alias match → context filtering.
// Every stored mention records which keywords matched and a confidence score.
// AI relevance (Milestone 4) only refines items this stage lets through.

import type { AliasKind } from "../domain/aliases.ts";

export interface AliasRule {
  term: string;
  kind: AliasKind;
  isAmbiguous: boolean;
  contextTerms: string[];
  negativeTerms: string[];
  enabled: boolean;
}

export type RuleStatus = "relevant" | "pending";

export interface RelevanceMatch {
  matchedTerms: string[];
  /** 0..1 confidence that the item is about the product. */
  score: number;
  /** "pending" = plausible but needs review (ambiguous or context-only match). */
  status: RuleStatus;
  /** How the match was made, for display ("keyword", "context", "thread"). */
  basis: "direct" | "ambiguous" | "thread";
}

/** Scores below this are not stored at all. */
export const MIN_STORE_SCORE = 0.5;
/** Scores at or above this are treated as relevant without review. */
export const RELEVANT_SCORE = 0.75;

const BASE: Record<AliasKind, number> = {
  domain: 0.95,
  exact_name: 0.9,
  handle: 0.85,
  custom: 0.8,
  abbreviation: 0.75,
  misspelling: 0.75,
};

const regexCache = new Map<string, RegExp>();

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive. "Linear" matches "linear's" but not "nonlinear". */
export function termRegex(term: string): RegExp {
  const key = term.toLowerCase();
  let re = regexCache.get(key);
  if (!re) {
    const body = escape(term.trim()).replace(/\s+/g, "[\\s\\-_]+");
    re = new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, "iu");
    if (regexCache.size > 5000) regexCache.clear();
    regexCache.set(key, re);
  }
  return re;
}

export function containsTerm(text: string, term: string): boolean {
  return term.trim().length > 0 && termRegex(term).test(text);
}

function baseScore(rule: AliasRule): number {
  // Repository slugs and other dotted/slashed custom terms are as specific as a domain.
  if (rule.kind === "custom" && /[./]/.test(rule.term)) return 0.95;
  return BASE[rule.kind] ?? 0.75;
}

/**
 * Decides whether an item is about the product.
 *  - a keyword must appear in the item's own text (title/body/link)
 *  - ambiguous keywords count only with a context term (in the item or its thread)
 *  - a keyword's exclusion terms veto that keyword
 *  - if nothing matches directly, a non-ambiguous keyword in the surrounding
 *    thread (story / video title) makes it a low-confidence "thread" match
 * Returns null when the item should not be stored.
 */
export function evaluateRelevance(rules: AliasRule[], matchText: string, contextText?: string | null): RelevanceMatch | null {
  const active = rules.filter((r) => r.enabled && r.term.trim().length > 0);
  const both = contextText ? `${matchText}\n${contextText}` : matchText;
  const direct: Array<{ term: string; score: number; ambiguous: boolean }> = [];

  for (const r of active) {
    if (!containsTerm(matchText, r.term)) continue;
    if (r.negativeTerms.some((n) => containsTerm(matchText, n))) continue;
    if (r.isAmbiguous) {
      if (r.contextTerms.length === 0 || !r.contextTerms.some((c) => containsTerm(both, c))) continue;
      direct.push({ term: r.term, score: 0.6, ambiguous: true });
    } else {
      direct.push({ term: r.term, score: baseScore(r), ambiguous: false });
    }
  }

  if (direct.length > 0) {
    direct.sort((a, b) => b.score - a.score);
    const top = direct[0]!;
    const score = Math.min(0.99, top.score + 0.05 * (direct.length - 1));
    return {
      matchedTerms: [...new Set(direct.map((d) => d.term))],
      score: round(score),
      status: score >= RELEVANT_SCORE ? "relevant" : "pending",
      basis: direct.every((d) => d.ambiguous) ? "ambiguous" : "direct",
    };
  }

  if (contextText) {
    const thread = active.filter(
      (r) => !r.isAmbiguous && containsTerm(contextText, r.term) && !r.negativeTerms.some((n) => containsTerm(both, n)),
    );
    if (thread.length > 0) {
      return { matchedTerms: thread.map((r) => r.term), score: MIN_STORE_SCORE, status: "pending", basis: "thread" };
    }
  }
  return null;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
