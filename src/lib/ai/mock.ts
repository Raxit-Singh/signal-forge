// Test classifier (pure). A deterministic keyword heuristic with the same
// interface as the real model, so the whole pipeline (budget, cache, storage,
// embeddings, grouping, priorities, evidence validation, UI) can be exercised
// without paid calls. Only selectable outside production; its output is always
// labelled "test classifier" — it is not AI and its labels are not analysis.

import type { AiCall, AiProviderClient, AiResult, IntelCategory, Severity } from "./types.ts";
import type {
  ClassificationOutput, ClusterSummaryOutput, EvidenceInput, FeatureEvaluationOutput, IssueDraftOutput, MergeCheckOutput, MergePairInput, PostInput, SpikeExplanationOutput,
} from "./prompts.ts";
import { estimateInputTokens } from "./pricing.ts";
import { normalize } from "./semantic.ts";

export const MOCK_MODEL = "mock-classifier";
export const MOCK_EMBEDDING_MODEL = "mock-embedding";

const RULES: Array<[RegExp, IntelCategory]> = [
  [/\b(crash|bug|broken|error|fails?|failing|doesn'?t work|not working|exception|freez|hang|stuck)\w*/i, "bug"],
  [/\b(please add|feature request|would love|wish it|should support|add support|roadmap)\b/i, "feature_request"],
  [/\b(expensive|overpriced|terrible support|disappointed|annoying|slow)\b/i, "complaint"],
  [/\b(how do i|how to|anyone know|help me)\b/i, "question"],
  [/\b(vs\.?|versus|better than|switched from|alternative to)\b/i, "competitor_comparison"],
  [/\b(love|great|awesome|amazing|fantastic|recommend)\b/i, "praise"],
];
const NEG = /\b(crash|bug|broken|hate|terrible|awful|slow|worst|error|fails?|annoying|expensive|freez|hang|stuck)\w*/gi;
const POS = /\b(love|great|awesome|amazing|fantastic|recommend|nice|excellent|helpful)\w*/gi;
const CRITICAL = /\b(payment|charged|billing|data loss|lost (my|all)|security|leak)\w*/i;
const AREAS: Array<[RegExp, string]> = [
  [/\b(log ?in|sign(ing)? ?in|password|auth)\w*/i, "login"],
  [/\b(payment|billing|charged|checkout)\w*/i, "billing"],
  [/\b(export|csv)\w*/i, "export"],
  [/\b(sync|offline)\w*/i, "sync"],
];
/** Mentions of these words for the product are about something else (test fixture convention). */
const OFF_TOPIC = /\b(mouse cursor|blinking cursor|text cursor)\b/i;

export function mockClassify(posts: PostInput[]): ClassificationOutput {
  return {
    items: posts.map((p) => {
      const text = `${p.title ?? ""} ${p.text}`;
      const neg = (text.match(NEG) ?? []).length;
      const pos = (text.match(POS) ?? []).length;
      const category = RULES.find(([re]) => re.test(text))?.[1] ?? "general_discussion";
      const severity: Severity = CRITICAL.test(text) ? "critical" : category === "bug" ? "high" : category === "feature_request" ? "medium" : "low";
      return {
        id: p.id,
        relevance: OFF_TOPIC.test(text) ? "irrelevant" : "relevant",
        sentiment: neg && pos ? "mixed" : neg ? "negative" : pos ? "positive" : "neutral",
        category,
        signals: {
          bug: category === "bug", feature_request: category === "feature_request", usability: false, complaint: category === "complaint",
          competitor_comparison: category === "competitor_comparison", question: category === "question",
          actionable: ["bug", "feature_request", "complaint"].includes(category),
        },
        severity,
        area: AREAS.find(([re]) => re.test(text))?.[1] ?? "",
        confidence: category === "general_discussion" ? 0.6 : 0.75,
        reason: "Test classifier: keyword heuristic, not an AI judgement.",
      };
    }),
  };
}

// Synonyms share a hash bucket so paraphrases land close together.
const SYNONYMS: Record<string, string> = {
  freezes: "freeze", freezing: "freeze", frozen: "freeze", hang: "freeze", hangs: "freeze", stuck: "freeze",
  login: "login", log: "login", signing: "login", sign: "login", signin: "login",
};
const STOP = new Set(["the", "and", "when", "app", "gets", "makes", "forever", "opening", "screen", "with", "after", "every", "time", "in", "i", "on", "my", "it", "a", "to", "of"]);

export function mockEmbed(text: string, dims = 128): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const raw of text.toLowerCase().replace(/^task:[^|]*\|\s*query:/, "").match(/[a-z]{2,}/g) ?? []) {
    if (STOP.has(raw)) continue;
    const w = SYNONYMS[raw] ?? raw.replace(/(ing|es|s)$/, "");
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[Math.abs(h) % dims]! += 1;
  }
  return normalize(v);
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
  return { insufficient_evidence: e.insufficient_evidence, summary: e.summary, findings: e.drivers.map((d) => ({ ...d, tier: "reported" as const })) };
}

export function mockEvaluateFeature(evidence: EvidenceInput[]): FeatureEvaluationOutput {
  const e = mockExplain(evidence);
  return {
    insufficient_evidence: e.insufficient_evidence, summary: e.summary,
    findings: e.drivers.map((d) => ({ ...d, tier: "reported" as const, aspect: "need" as const })),
    open_questions: e.insufficient_evidence ? [] : ["Test classifier: no real questions are generated."],
  };
}

export function mockDraftIssue(evidence: EvidenceInput[]): IssueDraftOutput {
  const e = mockExplain(evidence);
  const word = commonWord(evidence) ?? "issue";
  return {
    insufficient_evidence: e.insufficient_evidence, title: `Test classifier draft: "${word}"`, summary: e.summary,
    details: e.drivers.map((d) => ({ ...d, tier: "reported" as const })),
  };
}

export function mockMergeCheck(pairs: MergePairInput[]): MergeCheckOutput {
  return { pairs: pairs.map((p) => ({ id: p.id, same_issue: "unsure" as const })) };
}

export function mockClient(): AiProviderClient {
  return {
    provider: "mock",
    modelFor: () => MOCK_MODEL,
    embeddingModel: () => MOCK_EMBEDDING_MODEL,
    async generate<T>(call: AiCall<T>): Promise<AiResult<T>> {
      const input = (call.mockInput ?? {}) as { posts?: PostInput[]; evidence?: EvidenceInput[]; pairs?: MergePairInput[] };
      const raw =
        call.purpose === "classify" ? mockClassify(input.posts ?? [])
        : call.purpose === "merge_check" ? mockMergeCheck(input.pairs ?? [])
        : call.purpose === "spike_explanation" ? mockExplain(input.evidence ?? [])
        : call.purpose === "feature_evaluation" ? mockEvaluateFeature(input.evidence ?? [])
        : call.purpose === "issue_draft" ? mockDraftIssue(input.evidence ?? [])
        : mockSummarize(input.evidence ?? []);
      const output = call.schema.parse(raw);
      return {
        output, model: MOCK_MODEL,
        usage: { inputTokens: estimateInputTokens(call.system, call.user), outputTokens: Math.ceil(JSON.stringify(raw).length / 3), cachedTokens: 0 },
      };
    },
    async embed(texts: string[]) {
      return {
        vectors: texts.map((t) => mockEmbed(t)), model: MOCK_EMBEDDING_MODEL, estimated: true,
        usage: { inputTokens: Math.ceil(texts.join("").length / 4), outputTokens: 0, cachedTokens: 0 },
      };
    },
  };
}

/** The test classifier is never available in production builds or on Vercel deployments. */
export function mockAllowed(env: { NODE_ENV?: string; VERCEL_ENV?: string }): boolean {
  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") return false;
  return !env.VERCEL_ENV || env.VERCEL_ENV === "development";
}
