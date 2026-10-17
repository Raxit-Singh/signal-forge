// AI layer types (pure). Providers, calls and errors shared by the pipeline,
// the gateway (budget + cache) and the provider adapters.

import type { z } from "zod";

export type AiProviderId = "anthropic" | "openai" | "gemini" | "mock";
/** Cheap = bulk classification; deep = on-demand analysis (spike explanations, issue summaries). */
export type AiTier = "cheap" | "deep";
export type AiPurpose = "classify" | "spike_explanation" | "cluster_summary" | "validation";

export const SENTIMENTS = ["positive", "negative", "neutral", "mixed", "uncertain"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const FEEDBACK_CATEGORIES = [
  "bug_report", "feature_request", "usability_complaint", "pricing_complaint",
  "performance_issue", "security_concern", "positive_review", "general_discussion",
  "support_question", "competitor_comparison",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export interface AiCall<T> {
  purpose: AiPurpose;
  tier: AiTier;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Name for the provider's structured-output schema. */
  schemaName: string;
  maxTokens: number;
  /**
   * Structured view of the same input, used only by the test classifier (mock),
   * which can't read prose. Real providers ignore it.
   */
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

export interface AiProviderClient {
  provider: AiProviderId;
  modelFor(tier: AiTier): string;
  generate<T>(call: AiCall<T>): Promise<AiResult<T>>;
  /** Minimal, token-free call proving the key works (lists models). */
  validate(): Promise<{ ok: true; models: string[] } | { ok: false; kind: AiErrorKind; message: string }>;
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
