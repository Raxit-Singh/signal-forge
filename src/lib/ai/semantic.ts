// Semantic issue grouping (pure).
//
// Economical and conservative:
//   1. Each feedback mention has an embedding (Gemini embedding model, stored as real[]).
//   2. Within a category, posts join a group when they are very close to its centroid
//      (cosine ≥ `join`) — confident paraphrases like "freezes on login" / "signing in
//      gets stuck".
//   3. Groups whose centroids are close but not that close (`candidate` ≤ cos < `join`)
//      become merge candidates. A cheap model checks a bounded number of them; only a
//      "yes" merges. Similar topics are NOT assumed to share a root cause.
//   4. Without embeddings (test classifier, embedding failure) the word-based grouping
//      in cluster.ts is used instead.
//
// Thresholds are configuration, not measured truth: they haven't been calibrated on
// production data yet (see API_LIMITATIONS.md).

import { describeGroup, independentReports, MIN_INDEPENDENT_REPORTS, CLUSTER_CATEGORIES, tokenize, type ClusterInput, type ComputedCluster } from "./cluster.ts";
import type { FeedbackCategory } from "./types.ts";

export interface SemanticThresholds {
  join: number;
  candidate: number;
  /** Most merge candidates sent to the model per recluster. */
  maxChecks: number;
}

export const DEFAULT_THRESHOLDS: SemanticThresholds = { join: 0.86, candidate: 0.74, maxChecks: 40 };

export interface SemanticItem extends ClusterInput {
  vector: number[];
}

export function normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return n === 0 ? v.map(() => 0) : v.map((x) => x / n);
}

export function dot(a: number[], b: number[]): number {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i]! * b[i]!;
  return s;
}

interface Group {
  category: FeedbackCategory;
  idx: number[];
  sum: number[];
}

const centroid = (g: Group) => normalize(g.sum);

export interface SemanticPlan {
  items: SemanticItem[];
  groups: Group[];
  /** Pairs of group indexes worth a model check, closest first. */
  candidates: Array<{ a: number; b: number; similarity: number }>;
}

/** Phase 1: confident groups and merge candidates. Items are processed oldest first (stable as posts arrive). */
export function planSemantic(input: SemanticItem[], t: SemanticThresholds = DEFAULT_THRESHOLDS): SemanticPlan {
  const items = input
    .filter((i) => CLUSTER_CATEGORIES.has(i.category) && i.vector.length > 0)
    .map((i) => ({ ...i, vector: normalize(i.vector) }))
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));
  const groups: Group[] = [];
  items.forEach((it, i) => {
    let best = -1;
    let bestSim = -1;
    groups.forEach((g, gi) => {
      if (g.category !== it.category) return;
      const s = dot(it.vector, centroid(g));
      if (s > bestSim) { bestSim = s; best = gi; }
    });
    if (best >= 0 && bestSim >= t.join) {
      const g = groups[best]!;
      g.idx.push(i);
      g.sum = g.sum.map((x, k) => x + it.vector[k]!);
    } else {
      groups.push({ category: it.category, idx: [i], sum: [...it.vector] });
    }
  });

  const candidates: SemanticPlan["candidates"] = [];
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      if (groups[a]!.category !== groups[b]!.category) continue;
      const s = dot(centroid(groups[a]!), centroid(groups[b]!));
      if (s >= t.candidate && s < t.join) candidates.push({ a, b, similarity: s });
    }
  }
  candidates.sort((x, y) => y.similarity - x.similarity || x.a - y.a || x.b - y.b);
  return { items, groups, candidates: candidates.slice(0, t.maxChecks) };
}

/** Phase 2: merge the confirmed pairs (union-find), then describe groups with ≥ 2 independent reports. */
export function finishSemantic(plan: SemanticPlan, confirmed: Array<{ a: number; b: number }>, exclude: ReadonlySet<string>): ComputedCluster[] {
  const parent = plan.groups.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  for (const { a, b } of confirmed) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const merged = new Map<number, Group>();
  plan.groups.forEach((g, i) => {
    const r = find(i);
    const m = merged.get(r);
    if (!m) merged.set(r, { category: g.category, idx: [...g.idx], sum: [...g.sum] });
    else {
      m.idx.push(...g.idx);
      m.sum = m.sum.map((x, k) => x + g.sum[k]!);
    }
  });

  const out: ComputedCluster[] = [];
  for (const g of merged.values()) {
    const members = g.idx.map((i) => plan.items[i]!);
    if (independentReports(members) < MIN_INDEPENDENT_REPORTS) continue;
    const c = centroid(g);
    const sims: Record<string, number> = {};
    for (const m of members) sims[m.id] = Math.round(Math.max(0, dot(m.vector, c)) * 1000) / 1000;
    out.push(describeGroup(g.category, members, sims, topTerms(members, exclude)));
  }
  return out.sort((a, b) => b.reportCount - a.reportCount || b.lastDetectedAt.localeCompare(a.lastDetectedAt));
}

/** Words shared by most members (for a readable title when no area is known). */
function topTerms(members: ClusterInput[], exclude: ReadonlySet<string>): string[] {
  const df = new Map<string, number>();
  for (const m of members) for (const w of new Set(tokenize(`${m.title ?? ""} ${m.text}`, exclude))) df.set(w, (df.get(w) ?? 0) + 1);
  const min = Math.max(2, Math.ceil(members.length / 2));
  return [...df.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([w]) => w);
}

/** Representative texts of a group for a merge check (most central first, bounded). */
export function groupSamples(plan: SemanticPlan, gi: number, n = 3, chars = 300): string[] {
  const g = plan.groups[gi]!;
  const c = centroid(g);
  return g.idx
    .map((i) => plan.items[i]!)
    .sort((x, y) => dot(y.vector, c) - dot(x.vector, c))
    .slice(0, n)
    .map((m) => `${m.title ? `${m.title}: ` : ""}${m.text}`.replace(/\s+/g, " ").slice(0, chars));
}

/** Text embedded for a mention (Gemini Embedding 2 takes the task as a prefix). */
export const embeddingText = (m: { title: string | null; content: string | null }) =>
  `task: clustering | query: ${`${m.title ?? ""}\n${m.content ?? ""}`.trim().slice(0, 4000)}`;
