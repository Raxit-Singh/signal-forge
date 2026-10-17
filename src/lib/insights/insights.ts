// Product Insights (pure): demand strength from measured facts, GitHub issue
// drafts assembled from cited statements, and matching against existing issues.
// Nothing here calls a model or writes to GitHub.

import type { PriorityResult } from "../ai/priority.ts";

type Observed = PriorityResult["evidence"]["observed"];

export type DemandStrength = "strong" | "moderate" | "early";

/**
 * How strongly a feature request is backed, from measured facts only (never the
 * model): independent people asking, on how many platforms, for how long, and
 * whether it is growing.
 */
export function demandStrength(o: Observed): { level: DemandStrength; reasons: string[] } {
  const reasons: string[] = [];
  let points = 0;
  if (o.independent_reporters >= 10) { points += 3; reasons.push(`${o.independent_reporters} different people asked`); }
  else if (o.independent_reporters >= 5) { points += 2; reasons.push(`${o.independent_reporters} different people asked`); }
  else reasons.push(`Only ${o.independent_reporters} different ${o.independent_reporters === 1 ? "person" : "people"} asked so far`);
  if (o.platforms.length >= 3) { points += 2; reasons.push(`Asked on ${o.platforms.length} platforms`); }
  else if (o.platforms.length === 2) { points += 1; reasons.push("Asked on 2 platforms"); }
  if (o.recurring) { points += 2; reasons.push(`Requested in ${o.weeks_active} different weeks`); }
  if (o.trend === "growing" || o.trend === "worsening") { points += 1; reasons.push("More requests this week than last"); }
  if (o.trend === "declining") reasons.push("Fewer requests this week than last");
  return { level: points >= 6 ? "strong" : points >= 3 ? "moderate" : "early", reasons };
}

export interface DraftInput {
  title: string;
  summary: string;
  details: Array<{ statement: string; tier?: "reported" | "hypothesis"; mentionIds: string[] }>;
}

export interface DraftEvidence { mention_id: string; url: string; source: string; title: string | null; published_at: string }

/** GitHub's issue body limit is 65,536 characters; a prefilled URL must stay well under browser limits. */
export const MAX_BODY_FOR_URL = 6000;

/**
 * Markdown body for a GitHub issue. Model text is plain statements; the layout,
 * reference numbers, links and measured counts come from stored data.
 */
export function buildIssueBody(d: DraftInput, evidence: DraftEvidence[], facts: { reporters: number; platforms: string[]; firstSeen: string | null; lastSeen: string | null } | null, sourceName: (id: string) => string): string {
  const ref = new Map<string, number>();
  const cite = (ids: string[]) => ids.map((id) => {
    if (!ref.has(id)) ref.set(id, ref.size + 1);
    return `[${ref.get(id)}]`;
  }).join("");
  const reported = d.details.filter((x) => x.tier !== "hypothesis");
  const hypotheses = d.details.filter((x) => x.tier === "hypothesis");
  const lines: string[] = [plain(d.summary), ""];
  if (reported.length) lines.push("### What users report", ...reported.map((x) => `- ${plain(x.statement)} ${cite(x.mentionIds)}`), "");
  if (hypotheses.length) lines.push("### Possible explanations (not confirmed)", ...hypotheses.map((x) => `- ${plain(x.statement)} ${cite(x.mentionIds)}`), "");
  if (facts) {
    const span = facts.firstSeen && facts.lastSeen ? `, ${facts.firstSeen.slice(0, 10)} to ${facts.lastSeen.slice(0, 10)}` : "";
    lines.push("### Reach", `${facts.reporters} independent reporter${facts.reporters === 1 ? "" : "s"} on ${facts.platforms.map(sourceName).join(", ")}${span}.`, "");
  }
  const byId = new Map(evidence.map((e) => [e.mention_id, e]));
  const cited = [...ref.entries()].sort((a, b) => a[1] - b[1]).map(([id, n]) => ({ n, e: byId.get(id) })).filter((x) => x.e);
  if (cited.length) {
    lines.push("### Sources", ...cited.map(({ n, e }) => `${n}. [${plain(e!.title || "Post").slice(0, 120)}](${e!.url.replace(/[()\s]/g, encodeURIComponent)}) — ${sourceName(e!.source)}, ${e!.published_at.slice(0, 10)}`), "");
  }
  lines.push("_Drafted with SignalForge from public posts. Statements are limited to what the cited posts say; review before filing._");
  return lines.join("\n");
}

/** Strips markdown/HTML control characters and @mentions from model or post text so it can't change the layout or ping people. */
function plain(s: string): string {
  return s.replace(/[\r\n]+/g, " ").replace(/[<>`*_#[\]|]/g, "").replace(/@(?=\w)/g, "@​").trim();
}

/**
 * GitHub's "new issue" page prefilled with the draft. The user reviews and submits it
 * on GitHub themselves: SignalForge never creates issues. Long bodies are cut at a line
 * boundary with a note, so the URL stays within browser limits.
 */
export function newIssueUrl(repo: string, title: string, body: string): string {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/.test(repo)) throw new Error("Invalid repository");
  let b = body;
  if (b.length > MAX_BODY_FOR_URL) {
    const cut = b.lastIndexOf("\n", MAX_BODY_FOR_URL - 80);
    b = `${b.slice(0, cut > 0 ? cut : MAX_BODY_FOR_URL - 80)}\n\n_(Shortened — copy the full draft from SignalForge.)_`;
  }
  const q = new URLSearchParams({ title: title.slice(0, 200), body: b });
  return `https://github.com/${repo}/issues/new?${q.toString()}`;
}

// ---------------------------------------------------------------------------
// Existing GitHub issues
// ---------------------------------------------------------------------------

const STOP = new Set([
  "the", "and", "for", "with", "when", "that", "this", "from", "into", "have", "has", "are", "was", "not", "but", "you", "your",
  "bug", "bugs", "reports", "report", "feature", "features", "request", "requests", "issue", "issues", "complaints", "about", "can", "cannot",
  "what", "does", "just", "like", "after", "before", "every", "really", "still", "also", "there", "their", "they", "them", "then", "than",
  "some", "any", "all", "one", "its", "app", "application", "makes", "gets", "get", "got", "would", "could", "should", "will", "please",
  "anyone", "else", "since", "now", "today", "again", "time", "times", "way", "use", "using", "used", "any", "how", "why", "who",
]);

export function terms(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z0-9][a-z0-9.+-]{2,}/g) ?? []).filter((w) => !STOP.has(w)))];
}

/**
 * Search words for an issue: its affected area, its stored top terms, then words
 * that recur in at least two of its posts (most frequent first), then its label.
 * The product's own name is left out (every issue in its repository mentions it).
 */
export function searchTerms(c: { title: string; area: string | null; topTerms: string[] }, productName: string, postTexts: string[] = []): string[] {
  const exclude = new Set(terms(productName));
  const counts = new Map<string, number>();
  for (const t of postTexts) for (const w of terms(t)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const recurring = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w]) => w);
  const words = [...terms(c.area ?? ""), ...c.topTerms.flatMap((t) => terms(t)), ...recurring, ...terms(c.title)].filter((w) => !exclude.has(w));
  return [...new Set(words)].slice(0, 5);
}

/** GitHub search query: issues (not PRs) in one repository containing any of the words. */
export function issueSearchQuery(repo: string, words: string[]): string {
  return `repo:${repo} is:issue ${words.map((w) => (/[\s"]/.test(w) ? `"${w.replace(/"/g, "")}"` : w)).join(" OR ")}`;
}

export interface GithubIssue { number: number; title: string; url: string; state: "open" | "closed"; updatedAt: string; comments: number }
export interface IssueMatch extends GithubIssue { overlap: number; shared: string[]; likely: boolean }

/**
 * Ranks search results by how many of the issue's terms their titles share. A
 * "likely duplicate" needs at least two shared terms covering half of the search
 * words; everything else is a "possibly related" result, never a claim.
 */
export function rankMatches(issues: GithubIssue[], words: string[]): IssueMatch[] {
  const want = new Set(words);
  return issues.map((i) => {
    const t = terms(i.title);
    const shared = [...new Set(t.filter((w) => want.has(w) || [...want].some((x) => x.length >= 5 && (w.startsWith(x) || x.startsWith(w)))))];
    const overlap = want.size ? shared.length / want.size : 0;
    return { ...i, overlap, shared, likely: shared.length >= 2 && overlap >= 0.5 };
  }).filter((m) => m.shared.length > 0)
    .sort((a, b) => b.overlap - a.overlap || (a.state === b.state ? 0 : a.state === "open" ? -1 : 1) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
}
