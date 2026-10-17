// SignalForge Intelligence types (pure). This is SYSTEM A: AI paid for and run
// by SignalForge (Gemini) to analyse collected mentions. The customer-connected
// Claude developer agent (SYSTEM B) lives in src/lib/agent and never uses this.

import type { z } from "zod";

export type AiProviderId = "gemini" | "mock";
/** Cheap = bulk classification and merge checks; deep = on-demand analysis. */
export type AiTier = "cheap" | "deep";
export type AiPurpose = "classify" | "embed" | "merge_check" | "spike_explanation" | "cluster_summary" | "feature_evaluation" | "issue_draft";

/** Stored sentiment values (uncertain = low confidence; the model itself answers with the first four). */
export const SENTIMENTS = ["positive", "negative", "neutral", "mixed", "uncertain"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

/** Stored feedback categories (database enum; includes earlier, finer-grained values). */
export const FEEDBACK_CATEGORIES = [
  "bug_report", "feature_request", "usability_complaint", "pricing_complaint",
  "performance_issue", "security_concern", "positive_review", "general_discussion",
  "support_question", "competitor_comparison", "complaint", "other",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/** The taxonomy SignalForge Intelligence answers with. */
export const INTEL_CATEGORIES = [
  "bug", "feature_request", "complaint", "praise", "question", "competitor_comparison", "general_discussion", "other",
] as const;
export type IntelCategory = (typeof INTEL_CATEGORIES)[number];

export const CATEGORY_TO_DB: Record<IntelCategory, FeedbackCategory> = {
  bug: "bug_report", feature_request: "feature_request", complaint: "complaint", praise: "positive_review",
  question: "support_question", competitor_comparison: "competitor_comparison", general_discussion: "general_discussion", other: "other",
};

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface AiCall<T> {
  purpose: AiPurpose;
  tier: AiTier;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Name for the provider's structured-output schema. */
  schemaName: string;
  maxTokens: number;
  /** Structured view of the same input, used only by the test classifier (which can't read prose). */
  mockInput?: unknown;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface AiResult<T> {
  output: T;
  usage: AiUsage;
  model: string;
}

export interface EmbedResult {
  vectors: number[][];
  usage: AiUsage;
  model: string;
  /** The provider reported no token count, so usage was estimated from characters. */
  estimated: boolean;
}

export interface AiProviderClient {
  provider: AiProviderId;
  modelFor(tier: AiTier): string;
  embeddingModel(): string | null;
  generate<T>(call: AiCall<T>): Promise<AiResult<T>>;
  embed(texts: string[]): Promise<EmbedResult>;
}

export type AiErrorKind =
  | "not_configured" | "auth" | "rate_limited" | "refused" | "invalid_output"
  | "unavailable" | "budget" | "bad_request";

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly retryAfterSeconds: number | null;
  /** Usage the provider reported before failing (billed even though the output is unusable). */
  readonly usage: AiUsage | null;

  constructor(kind: AiErrorKind, message: string, retryAfterSeconds: number | null = null, usage: AiUsage | null = null) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
    this.usage = usage;
  }

  get retryable() {
    return this.kind === "rate_limited" || this.kind === "unavailable";
  }
}
