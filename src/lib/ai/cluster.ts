// Feedback clustering (pure, deterministic, no AI calls).
//
// Classified feedback is grouped per category by text similarity (TF-IDF
// cosine against a running cluster centroid, product names removed so they
// don't make every post look alike). Only groups with at least two independent
// reports become issues; reposts and duplicates never add demand, and one
// author posting several times counts once.

import type { FeedbackCategory, Sentiment, Severity } from "./types.ts";

export const CLUSTER_CATEGORIES: ReadonlySet<FeedbackCategory> = new Set([
  "bug_report", "feature_request", "usability_complaint", "pricing_complaint",
  "performance_issue", "security_concern", "support_question", "competitor_comparison", "complaint",
]);

export const SIMILARITY_THRESHOLD = 0.3;
export const MIN_INDEPENDENT_REPORTS = 2;

export interface ClusterInput {
  id: string;
  category: FeedbackCategory;
  categoryConfidence: number;
  sentiment: Sentiment | null;
  title: string | null;
  text: string;
  source: string;
  authorId: string | null;
  publishedAt: string;
  /** AI-inferred affected area and severity (optional). */
  area?: string | null;
  severity?: Severity | null;
}

export interface ComputedCluster {
  category: FeedbackCategory;
  title: string;
  memberIds: string[];
  similarity: Record<string, number>;
  reportCount: number;
  uniqueReporters: number | null;
  platforms: string[];
  sentiment: Sentiment | null;
  suggestedPriority: "low" | "medium" | "high" | "critical";
  confidence: number;
  firstDetectedAt: string;
  lastDetectedAt: string;
  topTerms: string[];
  /** Most common AI-inferred area among members, when most of them agree. */
  area: string | null;
}

const STOP = new Set((
  "the a an and or but if then than that this those these there their they them you your yours we our ours i me my mine " +
  "he she it its his her is are was were be been being have has had do does did doing not no yes so too very just also " +
  "can could would should will shall may might must of in on at to for from by with about into over under again further " +
  "once here when where why how all any both each few more most other some such only own same what which who whom " +
  "get got getting use used using like really still even much many lot lots thing things one two make made way back " +
  "now new app apps tool tools product please thanks thank anyone someone something does doesnt dont cant wont isnt im ive " +
  "http https www com"
).split(" "));

export function tokenize(text: string, exclude: ReadonlySet<string>): string[] {
  return (text.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]{3,}/gu) ?? [])
    .filter((w) => !STOP.has(w) && !exclude.has(w) && !/^\d+$/.test(w));
}

type Vec = Map<string, number>;

function norm(v: Vec) {
  let s = 0;
  for (const x of v.values()) s += x * x;
  return Math.sqrt(s);
}

export function cosine(a: Vec, b: Vec): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, x] of small) dot += x * (big.get(k) ?? 0);
  const n = norm(a) * norm(b);
  return n === 0 ? 0 : dot / n;
}

function tfidf(docs: string[][]): Vec[] {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v: Vec = new Map();
    for (const [t, c] of tf) v.set(t, (1 + Math.log(c)) * Math.log((1 + n) / (1 + (df.get(t) ?? 0)) + 1));
    return v;
  });
}

function addInto(sum: Vec, v: Vec) {
  for (const [k, x] of v) sum.set(k, (sum.get(k) ?? 0) + x);
}

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug_report: "Bug reports", feature_request: "Feature requests", usability_complaint: "Usability complaints",
  pricing_complaint: "Pricing complaints", performance_issue: "Performance issues", security_concern: "Security concerns",
  positive_review: "Praise", general_discussion: "Discussion", support_question: "Support questions",
  competitor_comparison: "Competitor comparisons", complaint: "Complaints", other: "Other feedback",
};
export const categoryLabel = (c: FeedbackCategory) => CATEGORY_LABEL[c];

/** Independent reports: one per author (or per post when the author is unknown). */
export function independentReports(members: Pick<ClusterInput, "id" | "authorId" | "source">[]): number {
  return new Set(members.map((m) => (m.authorId ? `${m.source}:${m.authorId}` : `post:${m.id}`))).size;
}

export function suggestPriority(category: FeedbackCategory, reports: number, negativeShare: number): ComputedCluster["suggestedPriority"] {
  if (category === "security_concern") return reports >= 2 ? "critical" : "high";
  if (reports >= 10 || (category === "bug_report" && reports >= 5 && negativeShare >= 0.5)) return "high";
  if (reports >= 4 || (category === "bug_report" && reports >= 3)) return "medium";
  return "low";
}

/** Most common non-empty value when at least half the members share it. */
export function majorityArea(members: Pick<ClusterInput, "area">[]): string | null {
  const counts = new Map<string, number>();
  for (const m of members) if (m.area) counts.set(m.area, (counts.get(m.area) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best && best[1] * 2 >= members.length ? best[0] : null;
}

/** Statistics, title and confidence for one group of members (similarity = each member's match to the group). */
export function describeGroup(category: FeedbackCategory, members: ClusterInput[], similarity: Record<string, number>, topTerms: string[]): ComputedCluster {
  const reports = independentReports(members);
  const cohesion = members.reduce((s, m) => s + (similarity[m.id] ?? 0), 0) / members.length;
  const confidence = Math.round(Math.min(1, (members.reduce((s, m) => s + m.categoryConfidence, 0) / members.length) * Math.min(1, cohesion + 0.3)) * 100) / 100;
  const sentiments = members.map((m) => m.sentiment).filter((s): s is Sentiment => !!s && s !== "uncertain");
  const negativeShare = sentiments.length ? sentiments.filter((s) => s === "negative").length / sentiments.length : 0;
  const counts = new Map<Sentiment, number>();
  for (const s of sentiments) counts.set(s, (counts.get(s) ?? 0) + 1);
  const sentiment = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const area = majorityArea(members);
  const dates = members.map((m) => m.publishedAt).sort();
  const label = area ?? (topTerms.length ? topTerms.join(", ") : null);
  return {
    category,
    title: label ? `${CATEGORY_LABEL[category]}: ${label}` : CATEGORY_LABEL[category],
    memberIds: members.map((m) => m.id),
    similarity,
    reportCount: reports,
    uniqueReporters: members.every((m) => m.authorId) ? new Set(members.map((m) => `${m.source}:${m.authorId}`)).size : null,
    platforms: [...new Set(members.map((m) => m.source))].sort(),
    sentiment,
    suggestedPriority: suggestPriority(category, reports, negativeShare),
    confidence,
    firstDetectedAt: dates[0]!,
    lastDetectedAt: dates.at(-1)!,
    topTerms,
    area,
  };
}

/**
 * Groups feedback mentions. `exclude` holds product names/keywords (lowercase
 * words) that every post shares. Input order doesn't matter: posts are
 * processed oldest first so results are stable as new posts arrive.
 */
export function clusterFeedback(items: ClusterInput[], exclude: ReadonlySet<string>, threshold = SIMILARITY_THRESHOLD): ComputedCluster[] {
  const out: ComputedCluster[] = [];
  const byCategory = new Map<FeedbackCategory, ClusterInput[]>();
  for (const it of items) {
    if (!CLUSTER_CATEGORIES.has(it.category)) continue;
    const list = byCategory.get(it.category) ?? [];
    list.push(it);
    byCategory.set(it.category, list);
  }

  for (const [category, list] of byCategory) {
    list.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));
    const docs = list.map((m) => tokenize(`${m.title ?? ""} ${m.text}`, exclude));
    const vecs = tfidf(docs);
    const groups: Array<{ centroid: Vec; idx: number[] }> = [];
    vecs.forEach((v, i) => {
      if (v.size === 0) return;
      let best = -1;
      let bestSim = 0;
      groups.forEach((g, gi) => {
        const s = cosine(v, g.centroid);
        if (s > bestSim) { bestSim = s; best = gi; }
      });
      if (best >= 0 && bestSim >= threshold) {
        addInto(groups[best]!.centroid, v);
        groups[best]!.idx.push(i);
      } else {
        const c: Vec = new Map();
        addInto(c, v);
        groups.push({ centroid: c, idx: [i] });
      }
    });

    for (const g of groups) {
      const members = g.idx.map((i) => list[i]!);
      if (independentReports(members) < MIN_INDEPENDENT_REPORTS) continue;
      const sims: Record<string, number> = {};
      g.idx.forEach((i) => { sims[list[i]!.id] = Math.round(cosine(vecs[i]!, g.centroid) * 1000) / 1000; });
      const topTerms = [...g.centroid.entries()]
        .filter(([t]) => g.idx.filter((i) => docs[i]!.includes(t)).length >= Math.min(2, g.idx.length))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([t]) => t);
      out.push(describeGroup(category, members, sims, topTerms));
    }
  }
  return out.sort((a, b) => b.reportCount - a.reportCount || b.lastDetectedAt.localeCompare(a.lastDetectedAt));
}

export interface ExistingCluster {
  id: string;
  category: FeedbackCategory;
  status: "open" | "acknowledged" | "resolved" | "dismissed";
  memberIds: string[];
}

/**
 * Matches recomputed groups to stored clusters so ids and team decisions
 * (acknowledged / resolved / dismissed) survive re-clustering: a stored cluster
 * continues as the new group sharing most of its members (≥ half of the smaller
 * one). Unmatched open clusters are removed; unmatched clusters the team acted
 * on are kept as they were.
 */
export function reconcileClusters(existing: ExistingCluster[], computed: ComputedCluster[]) {
  const updates: Array<{ id: string; cluster: ComputedCluster }> = [];
  const inserts: ComputedCluster[] = [];
  const used = new Set<string>();
  for (const c of computed) {
    const members = new Set(c.memberIds);
    let best: ExistingCluster | null = null;
    let bestOverlap = 0;
    for (const e of existing) {
      if (used.has(e.id) || e.category !== c.category) continue;
      const overlap = e.memberIds.filter((id) => members.has(id)).length;
      if (overlap >= Math.ceil(Math.min(e.memberIds.length, members.size) / 2) && overlap > bestOverlap) {
        best = e;
        bestOverlap = overlap;
      }
    }
    if (best) {
      used.add(best.id);
      updates.push({ id: best.id, cluster: c });
    } else inserts.push(c);
  }
  const deletes = existing.filter((e) => !used.has(e.id) && e.status === "open").map((e) => e.id);
  return { updates, inserts, deletes };
}
