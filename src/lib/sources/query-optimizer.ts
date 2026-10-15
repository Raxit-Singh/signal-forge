// Platform-aware keyword query optimizer. Pure and deterministic.
//
// A product has up to 10 enabled keywords. Running one search per keyword per
// platform is wasteful, so keywords are grouped per platform:
//   * brand aliases (name, domain, handle, spelling variants) are OR-combined
//     where the platform supports OR, within its length/term limits
//   * a keyword containing another searched keyword as a whole word ("FocusFlow
//     review" ⊃ "FocusFlow") is already covered on word-matching platforms
//   * ambiguous keywords are only searched with their context terms, and only
//     where the platform supports grouping; otherwise they are reported as skipped
//   * generic/category phrases are never OR-combined with brand aliases (they
//     would drown them); they get their own lower-priority group
//   * on platforms without OR, the number of single-keyword queries is capped by
//     monitoring mode; uncapped keywords are reported, never silently dropped
// Every keyword still drives local relevance matching, searched or not.

import { createHash } from "node:crypto";
import { containsTerm } from "./relevance.ts";
import type { AliasKind } from "../domain/aliases.ts";
import type { QueryCapabilities } from "./types.ts";

export type MonitoringMode = "eco" | "balanced" | "priority";

export interface OptimizerKeyword {
  term: string;
  kind: AliasKind;
  isAmbiguous: boolean;
  contextTerms: string[];
}

export interface QueryGroup {
  expression: string;
  /** Keywords this query searches for. */
  terms: string[];
  role: "brand" | "ambiguous" | "category";
}

export interface SkippedKeyword {
  term: string;
  reason: "covered" | "ambiguous_unsupported" | "query_cap" | "too_long";
  detail: string;
}

export interface QueryPlan {
  groups: QueryGroup[];
  skipped: SkippedKeyword[];
}

export const MAX_KEYWORDS = 10;

/** Most single-keyword queries per platform without OR, by mode (paid platforms). */
export const NON_OR_QUERY_CAP: Record<MonitoringMode, number> = { eco: 1, balanced: 2, priority: 4 };

const BRAND_KINDS = new Set<AliasKind>(["exact_name", "domain", "handle", "misspelling", "abbreviation"]);
const PRIORITY: Record<AliasKind, number> = { exact_name: 0, domain: 1, handle: 2, custom: 3, abbreviation: 4, misspelling: 5 };

function clean(term: string): string {
  return term.replace(/["()]/g, " ").replace(/\s+/g, " ").trim();
}

function quote(term: string, caps: QueryCapabilities): string {
  const t = clean(term);
  return caps.exactPhrase && /[\s./@-]/.test(t) ? `"${t}"` : t;
}

function orJoin(parts: string[], caps: QueryCapabilities): string {
  if (parts.length === 1) return parts[0]!;
  return caps.booleanOr === "|" ? parts.join(" | ") : parts.join(" OR ");
}

/** A keyword is "category" when it is a custom phrase that doesn't contain any brand alias. */
function isCategory(k: OptimizerKeyword, brandTerms: string[]): boolean {
  return k.kind === "custom" && !brandTerms.some((b) => containsTerm(k.term, b));
}

/**
 * Builds the query groups for one platform stream.
 * `nonOrCap` limits single-keyword queries when the platform has no OR (null = no cap).
 */
export function planQueries(keywords: OptimizerKeyword[], caps: QueryCapabilities, nonOrCap: number | null): QueryPlan {
  const skipped: SkippedKeyword[] = [];
  const seen = new Set<string>();
  const list = keywords
    .map((k) => ({ ...k, term: clean(k.term) }))
    .filter((k) => {
      const key = k.term.toLowerCase();
      if (!k.term || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_KEYWORDS)
    .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.term.localeCompare(b.term));

  const brand = list.filter((k) => BRAND_KINDS.has(k.kind) && !k.isAmbiguous);
  const brandTerms = brand.map((k) => k.term);
  const ambiguous = list.filter((k) => k.isAmbiguous);
  const category = list.filter((k) => !k.isAmbiguous && !BRAND_KINDS.has(k.kind) && isCategory(k, brandTerms));
  const brandish = list.filter((k) => !k.isAmbiguous && k.kind === "custom" && !isCategory(k, brandTerms));

  // Custom phrases that contain a brand alias as a separate word ("FocusFlow pricing") are covered by
  // searching the alias. Punctuation-joined terms (domains, handles) are not: search engines tokenize them differently.
  const primary: OptimizerKeyword[] = [...brand];
  for (const k of brandish) {
    const by = /\s/.test(k.term) ? brandTerms.find((b) => containsTerm(k.term, b)) : undefined;
    if (caps.wordMatch && by) skipped.push({ term: k.term, reason: "covered", detail: `Found by searching "${by}"` });
    else primary.push(k);
  }

  const groups: QueryGroup[] = [];
  const pack = (items: OptimizerKeyword[], role: QueryGroup["role"]) => {
    let current: string[] = [];
    let terms: string[] = [];
    const flush = () => {
      if (current.length) groups.push({ expression: orJoin(current, caps), terms, role });
      current = [];
      terms = [];
    };
    for (const k of items) {
      const part = quote(k.term, caps);
      if (part.length > caps.maxQueryLength) {
        skipped.push({ term: k.term, reason: "too_long", detail: `Longer than this platform's ${caps.maxQueryLength}-character limit` });
        continue;
      }
      const next = orJoin([...current, part], caps);
      if (!caps.booleanOr || current.length >= caps.maxTerms || next.length > caps.maxQueryLength) flush();
      current.push(part);
      terms.push(k.term);
    }
    flush();
  };

  pack(primary, "brand");
  pack(category, "category");

  for (const k of ambiguous) {
    const ctx = k.contextTerms.map(clean).filter(Boolean).slice(0, 5);
    if (!caps.grouping || !caps.booleanOr || ctx.length === 0) {
      skipped.push({
        term: k.term, reason: "ambiguous_unsupported",
        detail: ctx.length === 0 ? "Ambiguous keyword without context terms" : "This platform can't require context words in a search",
      });
      continue;
    }
    const expression = `${quote(k.term, caps)} (${orJoin(ctx.map((c) => quote(c, caps)), caps)})`;
    if (expression.length > caps.maxQueryLength) {
      skipped.push({ term: k.term, reason: "too_long", detail: `Longer than this platform's ${caps.maxQueryLength}-character limit` });
      continue;
    }
    groups.push({ expression, terms: [k.term], role: "ambiguous" });
  }

  // Without OR every keyword is its own query; cap them by mode (highest priority first).
  if (!caps.booleanOr && nonOrCap !== null && groups.length > nonOrCap) {
    for (const g of groups.slice(nonOrCap)) {
      for (const t of g.terms) {
        skipped.push({ term: t, reason: "query_cap", detail: "Not searched on this platform in the current monitoring mode (still used to match results)" });
      }
    }
    groups.splice(nonOrCap);
  }
  return { groups, skipped };
}

export interface FingerprintInput {
  platform: string;
  stream: string;
  expression: string;
  language?: string | null;
  region?: string | null;
  filters?: Record<string, string | number | boolean | null>;
}

/** Normalized expression: case and whitespace don't change what a search returns. */
export function normalizeExpression(expression: string): string {
  return expression
    .replace(/\s+/g, " ")
    .trim()
    .replace(/"([^"]*)"/g, (_, p: string) => `"${p.toLowerCase()}"`)
    .replace(/(^|[\s(])([^\s()"]+)/g, (_, pre: string, w: string) => pre + (/^(OR|AND|NOT)$/.test(w) ? w : w.toLowerCase()));
}

/** Shared query registry key: identical public queries across products share one upstream fetch. */
export function queryFingerprint(i: FingerprintInput): string {
  const filters = Object.entries(i.filters ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const canonical = JSON.stringify([
    i.platform, i.stream, normalizeExpression(i.expression), (i.language ?? "").toLowerCase(), (i.region ?? "").toLowerCase(), filters,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
