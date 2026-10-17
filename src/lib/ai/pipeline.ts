// Staged AI pipeline decisions (pure):
//   1. rules      — keyword/alias/context relevance (sources/relevance.ts) decides what is stored
//   2. dedup      — exact duplicates and reposts are never sent to a model
//   3. classify   — cheap model, batched, cached by content hash
//   4. cluster    — deterministic grouping of classified feedback (cluster.ts)
//   5. deep       — evidence-backed analysis, only when a user asks for it

import { createHash } from "node:crypto";
import { cleanText, MAX_ITEM_CHARS, PROMPT_VERSION, type EvidenceInput, type PostInput } from "./prompts.ts";

export interface CandidateMention {
  id: string;
  source: string;
  title: string | null;
  content: string | null;
  contentHash: string | null;
  dedupKind: "original" | "exact_duplicate" | "repost";
  relevanceStatus: "pending" | "relevant" | "irrelevant" | "user_relevant" | "user_irrelevant";
  processingStatus: string;
}

export type SkipReason = "duplicate" | "excluded" | "empty" | "done";

/** Why a mention doesn't go to the classifier, or null when it should. */
export function skipReason(m: CandidateMention): SkipReason | null {
  if (m.processingStatus === "classified" || m.processingStatus === "skipped") return "done";
  if (m.dedupKind !== "original") return "duplicate";
  if (m.relevanceStatus === "irrelevant" || m.relevanceStatus === "user_irrelevant") return "excluded";
  if (!`${m.title ?? ""}${m.content ?? ""}`.trim()) return "empty";
  return null;
}

/** Posts per classification call, bounded by count and characters. */
export const BATCH_MAX_ITEMS = 20;
export const BATCH_MAX_CHARS = 24_000;

export function batchPosts<T extends { title: string | null; content: string | null }>(items: T[]): T[][] {
  const batches: T[][] = [];
  let cur: T[] = [];
  let chars = 0;
  for (const it of items) {
    const len = Math.min(MAX_ITEM_CHARS, (it.content ?? "").length) + (it.title ?? "").length;
    if (cur.length && (cur.length >= BATCH_MAX_ITEMS || chars + len > BATCH_MAX_CHARS)) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(it);
    chars += len;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/** Local ids (m1…) for a batch, and the reverse map back to mention ids. */
export function toPosts(items: Array<{ id: string; source: string; title: string | null; content: string | null }>) {
  const idMap = new Map<string, string>();
  const posts: PostInput[] = items.map((m, i) => {
    const local = `m${i + 1}`;
    idMap.set(local, m.id);
    return { id: local, source: m.source, title: cleanText(m.title, 300).text || null, text: cleanText(m.content, MAX_ITEM_CHARS).text };
  });
  return { posts, idMap };
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Cache key for one mention's classification: the same text classified for the
 * same product context, prompt version and model reuses the earlier answer
 * (reposts of identical text across sources, re-runs after failures).
 */
export function classificationCacheKey(opts: { workspaceId: string; productContextHash: string; model: string; title: string | null; content: string | null; contentHash: string | null }) {
  const text = opts.contentHash ?? sha256(`${opts.title ?? ""}\n${opts.content ?? ""}`);
  return sha256(["classify", PROMPT_VERSION, opts.workspaceId, opts.productContextHash, opts.model, sha256(opts.title ?? ""), text].join("|"));
}

export const productContextHash = (p: { name: string; description: string | null; keywords: string[] }) =>
  sha256(JSON.stringify([p.name, p.description ?? "", [...p.keywords].sort()]));

// ---------------------------------------------------------------------------
// Evidence for deep analysis
// ---------------------------------------------------------------------------

export const MIN_EVIDENCE = 3;
export const MAX_EVIDENCE = 40;
const EVIDENCE_CHARS = 1200;

export interface EvidenceMention {
  id: string;
  source: string;
  publishedAt: string;
  title: string | null;
  content: string | null;
  engagementScore: number;
  aiAboutProduct: "yes" | "no" | "unsure" | null;
}

/**
 * Picks the posts a model may cite: about the product (AI didn't say "no"),
 * most-engaged first, bounded. Fewer than MIN_EVIDENCE → no call is made and
 * the answer is "insufficient data".
 */
export function selectEvidence(mentions: EvidenceMention[]): { evidence: EvidenceInput[]; idMap: Map<string, string> } | null {
  const usable = mentions
    .filter((m) => m.aiAboutProduct !== "no" && `${m.title ?? ""}${m.content ?? ""}`.trim())
    .sort((a, b) => b.engagementScore - a.engagementScore || b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id))
    .slice(0, MAX_EVIDENCE);
  if (usable.length < MIN_EVIDENCE) return null;
  const idMap = new Map<string, string>();
  const evidence = usable.map((m, i) => {
    const local = `e${i + 1}`;
    idMap.set(local, m.id);
    return {
      id: local, source: m.source, published: m.publishedAt.slice(0, 16).replace("T", " "),
      title: cleanText(m.title, 300).text || null, text: cleanText(m.content, EVIDENCE_CHARS).text, engagement: m.engagementScore,
    };
  });
  return { evidence, idMap };
}
