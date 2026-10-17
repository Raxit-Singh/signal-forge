// Weekly product reports (pure). Every number is computed from stored data at
// generation time with the same functions as the dashboards; highlights are
// rule-based sentences about those numbers (no model).

export const REPORT_VERSION = 1;

/** The last complete UTC week (Monday 00:00 to the next Monday) before `now`. */
export function lastCompleteWeek(now: Date): { start: Date; end: Date } {
  const day = now.getUTCDay(); // 0 = Sunday
  const sinceMonday = (day + 6) % 7;
  const thisMonday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday);
  return { start: new Date(thisMonday - 7 * 86_400_000), end: new Date(thisMonday) };
}

export interface PeriodNumbers {
  mentions: number;
  posts: number;
  comments: number;
  uniqueAuthors: number;
  engagement: number;
  /** Share of the period monitoring covered (0..1, averaged over sources). */
  coverage: number;
  bySource: Array<{ source: string; mentions: number }>;
  sentiment: { classified: number; unclassified: number; positive: number; negative: number; neutral: number; mixed: number; uncertain: number };
  feedback: { bugs: number; features: number; complaints: number; praise: number; questions: number };
}

export interface ReportData {
  version: number;
  product: { id: string; name: string };
  period: { start: string; end: string; label: string };
  generatedAt: string;
  current: PeriodNumbers;
  previous: PeriodNumbers;
  daily: Array<{ day: string; mentions: number }>;
  issues: Array<{ id: string; title: string; category: string; priority: string | null; postsInPeriod: number; reporters: number; isNew: boolean; trend: string | null }>;
  spikes: Array<{ start: string; platform: string | null; keyword: string | null; observed: number; expected: number; severity: string; confidence: string }>;
  competitors: { sources: string[]; rows: Array<{ name: string; isProduct: boolean; mentions: number; share: number | null }> } | null;
  topPosts: Array<{ title: string; url: string; source: string; publishedAt: string; engagement: number }>;
  highlights: string[];
}

/** Change vs the previous period, or null when it can't be stated honestly. */
export function change(current: number, previous: number, coverage: { current: number; previous: number }): { pct: number | null; note: string } {
  if (coverage.previous < 0.5 || coverage.current < 0.5) return { pct: null, note: "not comparable (monitoring covered less than half of a period)" };
  if (previous === 0) return { pct: null, note: current === 0 ? "no change" : "none the week before" };
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct, note: pct === 0 ? "no change" : `${pct > 0 ? "+" : ""}${pct}% vs the week before` };
}

const sourceLabel = (s: string, name: (id: string) => string) => name(s);

/** Plain-language highlights derived from the numbers by fixed rules. */
export function highlights(d: Omit<ReportData, "highlights">, sourceName: (id: string) => string): string[] {
  const out: string[] = [];
  const cov = { current: d.current.coverage, previous: d.previous.coverage };
  const m = change(d.current.mentions, d.previous.mentions, cov);
  out.push(d.current.mentions === 0
    ? "No relevant mentions were collected this week."
    : `${d.current.mentions.toLocaleString("en-US")} relevant mention${d.current.mentions === 1 ? "" : "s"}${m.pct !== null ? ` (${m.note})` : ""}.`);
  const top = [...d.current.bySource].sort((a, b) => b.mentions - a.mentions)[0];
  if (top && top.mentions > 0 && d.current.mentions > 0) {
    out.push(`Most mentions came from ${sourceLabel(top.source, sourceName)} (${Math.round((top.mentions / d.current.mentions) * 100)}%).`);
  }
  const s = d.current.sentiment;
  const p = d.previous.sentiment;
  if (s.classified >= 20) {
    const neg = s.negative / s.classified;
    const prevNeg = p.classified >= 20 ? p.negative / p.classified : null;
    const shift = prevNeg !== null && Math.abs(neg - prevNeg) >= 0.1 ? `, ${neg > prevNeg ? "up" : "down"} from ${Math.round(prevNeg * 100)}%` : "";
    out.push(`${Math.round(neg * 100)}% of classified mentions were negative${shift}.`);
  }
  const fresh = d.issues.filter((i) => i.isNew);
  const urgent = d.issues.filter((i) => i.priority === "critical" || i.priority === "high");
  if (urgent.length) out.push(`${urgent.length} high-priority issue${urgent.length === 1 ? "" : "s"} had activity, led by “${urgent[0]!.title}”.`);
  if (fresh.length) out.push(`${fresh.length} new issue${fresh.length === 1 ? "" : "s"} appeared${fresh.length ? `, including “${fresh[0]!.title}”` : ""}.`);
  const confirmed = d.spikes.filter((x) => x.confidence === "confirmed");
  if (confirmed.length) out.push(`${confirmed.length} confirmed spike${confirmed.length === 1 ? "" : "s"} in mention volume.`);
  if (d.competitors && d.competitors.rows.length > 1) {
    const me = d.competitors.rows.find((r) => r.isProduct);
    if (me?.share !== null && me?.share !== undefined) out.push(`Share of voice against tracked competitors: ${Math.round(me.share * 100)}%.`);
  }
  if (d.current.coverage < 0.9) out.push(`Monitoring covered ${Math.round(d.current.coverage * 100)}% of the week, so counts may be incomplete.`);
  return out;
}

/** CSV with one section per table; values quoted where needed. */
export function reportCsv(d: ReportData, sourceName: (id: string) => string): string {
  const q = (v: unknown) => {
    const s = String(v ?? "");
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // no formula injection when opened in a spreadsheet
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows: unknown[][] = [];
  const section = (title: string, head: string[], body: unknown[][]) => {
    rows.push([title], head, ...body, []);
  };
  section("Report", ["product", "period_start", "period_end", "generated_at"], [[d.product.name, d.period.start, d.period.end, d.generatedAt]]);
  section("Summary", ["metric", "this_week", "previous_week"], [
    ["relevant_mentions", d.current.mentions, d.previous.mentions],
    ["posts", d.current.posts, d.previous.posts],
    ["comments", d.current.comments, d.previous.comments],
    ["unique_authors", d.current.uniqueAuthors, d.previous.uniqueAuthors],
    ["engagement", d.current.engagement, d.previous.engagement],
    ["coverage", d.current.coverage.toFixed(3), d.previous.coverage.toFixed(3)],
    ["classified", d.current.sentiment.classified, d.previous.sentiment.classified],
    ["positive", d.current.sentiment.positive, d.previous.sentiment.positive],
    ["negative", d.current.sentiment.negative, d.previous.sentiment.negative],
    ["bug_reports", d.current.feedback.bugs, d.previous.feedback.bugs],
    ["feature_requests", d.current.feedback.features, d.previous.feedback.features],
    ["complaints", d.current.feedback.complaints, d.previous.feedback.complaints],
  ]);
  section("Daily", ["day", "relevant_mentions"], d.daily.map((x) => [x.day, x.mentions]));
  section("By platform", ["platform", "relevant_mentions"], d.current.bySource.map((x) => [sourceName(x.source), x.mentions]));
  section("Issues", ["title", "category", "priority", "posts_this_week", "reporters", "new"], d.issues.map((i) => [i.title, i.category, i.priority ?? "", i.postsInPeriod, i.reporters, i.isNew ? "yes" : "no"]));
  section("Spikes", ["start", "platform", "keyword", "observed", "expected", "severity", "confidence"], d.spikes.map((x) => [x.start, x.platform ?? "all", x.keyword ?? "", x.observed, x.expected, x.severity, x.confidence]));
  if (d.competitors) section("Share of voice", ["name", "relevant_mentions", "share"], d.competitors.rows.map((r) => [r.name, r.mentions, r.share === null ? "" : r.share.toFixed(3)]));
  section("Top posts", ["title", "platform", "published", "engagement", "url"], d.topPosts.map((p) => [p.title, sourceName(p.source), p.publishedAt, p.engagement, p.url]));
  return rows.map((r) => r.map(q).join(",")).join("\r\n");
}
