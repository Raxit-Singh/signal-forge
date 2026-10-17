// Test classifier (pure). A deterministic keyword heuristic with the same
// interface as a real model, so the whole pipeline (budget, cache, storage,
// clustering, evidence validation, UI) can be exercised without paid calls.
// It is only selectable outside production and its output is always labelled
// "test classifier" — it is not an AI and its labels are not real analysis.

import type { AiCall, AiProviderClient, AiResult, FeedbackCategory, Sentiment } from "./types.ts";
import type { ClassificationOutput, ClusterSummaryOutput, EvidenceInput, PostInput, SpikeExplanationOutput } from "./prompts.ts";
import { estimateInputTokens } from "./pricing.ts";

export const MOCK_MODEL = "mock-classifier";

const RULES: Array<[RegExp, FeedbackCategory]> = [
  [/\b(security|vulnerab|leak|exploit|breach|phishing)\w*/i, "security_concern"],
  [/\b(crash|bug|broken|error|fails?|failing|doesn'?t work|not working|exception)\w*/i, "bug_report"],
  [/\b(slow|lag|latency|takes forever|timeout|memory)\w*/i, "performance_issue"],
  [/\b(please add|feature request|would love|wish it|should support|add support|roadmap)\b/i, "feature_request"],
  [/\b(expensive|pricing|price|too much money|subscription cost)\b/i, "pricing_complaint"],
  [/\b(confusing|hard to use|unintuitive|can'?t find)\b/i, "usability_complaint"],
  [/\b(how do i|how to|anyone know|help me)\b/i, "support_question"],
  [/\b(vs\.?|versus|better than|switched from|alternative to)\b/i, "competitor_comparison"],
  [/\b(love|great|awesome|amazing|fantastic|recommend)\b/i, "positive_review"],
];
const NEG = /\b(crash|bug|broken|hate|terrible|awful|slow|worst|error|fails?|annoying|expensive|confusing)\w*/gi;
const POS = /\b(love|great|awesome|amazing|fantastic|recommend|nice|excellent|helpful)\w*/gi;

export function mockClassify(posts: PostInput[]): ClassificationOutput {
  return {
    items: posts.map((p) => {
      const text = `${p.title ?? ""} ${p.text}`;
      const neg = (text.match(NEG) ?? []).length;
      const pos = (text.match(POS) ?? []).length;
      const sentiment: Sentiment = neg && pos ? "mixed" : neg ? "negative" : pos ? "positive" : "neutral";
      const category = RULES.find(([re]) => re.test(text))?.[1] ?? "general_discussion";
      return {
        id: p.id, about_product: "yes", sentiment, sentiment_confidence: neg || pos ? 0.7 : 0.6,
        category, category_confidence: category === "general_discussion" ? 0.55 : 0.75,
        reason: "Test classifier: keyword heuristic, not an AI judgement.",
      };
    }),
  };
}

function commonWord(evidence: EvidenceInput[]): string | null {
  const counts = new Map<string, number>();
  for (const e of evidence) for (const w of new Set(`${e.title ?? ""} ${e.text}`.toLowerCase().match(/[a-z]{5,}/g) ?? [])) counts.set(w, (counts.get(w) ?? 0) + 1);
  const best = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best?.[0] ?? null;
}

export function mockExplain(evidence: EvidenceInput[]): SpikeExplanationOutput {
  const word = commonWord(evidence);
  const cited = [...evidence].sort((a, b) => b.engagement - a.engagement).slice(0, 3).map((e) => e.id);
  if (!word) return { insufficient_evidence: true, summary: "", drivers: [], confidence: "low" };
  return {
    insufficient_evidence: false,
    summary: `Test classifier: the most common word in these posts is "${word}".`,
    drivers: [{ statement: `Several posts mention "${word}" (test classifier, word count only).`, mention_ids: cited }],
    confidence: "low",
  };
}

export function mockSummarize(evidence: EvidenceInput[]): ClusterSummaryOutput {
  const e = mockExplain(evidence);
  return {
    insufficient_evidence: e.insufficient_evidence,
    summary: e.summary,
    findings: e.drivers.map((d) => ({ ...d, tier: "reported" as const })),
  };
}

export function mockClient(): AiProviderClient {
  return {
    provider: "mock",
    modelFor: () => MOCK_MODEL,
    async generate<T>(call: AiCall<T>): Promise<AiResult<T>> {
      const input = (call.mockInput ?? {}) as { posts?: PostInput[]; evidence?: EvidenceInput[] };
      const raw =
        call.purpose === "classify" ? mockClassify(input.posts ?? [])
        : call.purpose === "spike_explanation" ? mockExplain(input.evidence ?? [])
        : mockSummarize(input.evidence ?? []);
      const output = call.schema.parse(raw);
      return {
        output,
        model: MOCK_MODEL,
        usage: { inputTokens: estimateInputTokens(call.system, call.user), outputTokens: Math.ceil(JSON.stringify(raw).length / 3), cachedTokens: 0 },
      };
    },
    async validate() {
      return { ok: true as const, models: [MOCK_MODEL] };
    },
  };
}

/** The test classifier is never available in production builds or on Vercel deployments. */
export function mockAllowed(env: Record<string, string | undefined>): boolean {
  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") return false;
  return !env.VERCEL_ENV || env.VERCEL_ENV === "development";
}
