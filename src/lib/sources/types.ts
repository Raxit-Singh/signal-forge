// Common contract for every data source. Framework-free so it can be unit
// tested with `node --test` and deterministic fixtures.

export type PublicSourceId = "hackernews" | "github" | "stackexchange" | "youtube";

export interface SearchWindow {
  /** inclusive */
  since: Date;
  /** exclusive */
  until: Date;
}

export interface SearchRequest {
  /** Keywords to search for. Adapters that support OR combine them into one call. */
  terms: string[];
  window: SearchWindow;
  /** Upper bound on result pages, so one run can't exhaust a shared quota. */
  maxPages: number;
  signal?: AbortSignal;
}

/** A source item in SignalForge's shape, before relevance filtering. */
export interface CandidateMention {
  externalId: string;
  sourceUrl: string;
  parentExternalId?: string | null;
  authorExternalId?: string | null;
  authorDisplay?: string | null;
  title?: string | null;
  /** Permitted excerpt that will be stored (already trimmed). */
  content?: string | null;
  language?: string | null;
  publishedAt: Date;
  engagement: Record<string, number>;
  engagementScore: number;
  /** External link the item shares (repost detection), normalized. */
  linkedUrl?: string | null;
  /** Text searched for keywords: title + body (+ url). */
  matchText: string;
  /** Surrounding context (e.g. the story/video a comment belongs to). Weaker evidence. */
  contextText?: string | null;
}

export interface RateLimitSnapshot {
  remaining?: number;
  limit?: number;
  resetAt?: string;
}

export interface SearchResult {
  items: CandidateMention[];
  /** false when results were capped (page limit, API result cap) — coverage is then partial. */
  complete: boolean;
  incompleteReason?: string;
  rateLimit?: RateLimitSnapshot;
}

/** One HTTP call made through the rate limiter. */
export interface SourceRequest {
  url: string;
  /** Quota units this call consumes (YouTube search = 100, most others = 1). */
  cost?: number;
  /** Short label for usage accounting, e.g. "search", "videos". */
  endpoint: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface SourceContext {
  /** Rate-limited, usage-recorded HTTP GET. Throws SourceError on limiter refusal. */
  request(req: SourceRequest): Promise<Response>;
  /** Ask the limiter to pause this source (e.g. Stack Exchange `backoff`, quota exhausted). */
  cooldown(seconds: number, endpoint?: string): Promise<void>;
  now(): Date;
}

export interface RateLimitPolicy {
  /** Bucket key shared by every worker. */
  key: string;
  capacity: number;
  refillPerSecond: number;
}

export type Configured = { ok: true } | { ok: false; reason: string };

/**
 * Public, keyword-searchable sources (no customer authorization needed).
 * Sources that need a customer's account (App Store Connect, Google Play,
 * Discord, GitHub App repositories) implement AuthorizedSourceAdapter later.
 */
export interface SourceAdapter {
  id: PublicSourceId;
  name: string;
  /** Whether the server has what this source needs (API key etc.). */
  configured(): Configured;
  /** Bucket for a call; sources with per-endpoint quotas (YouTube search) return different buckets. */
  rateLimit(endpoint?: string): RateLimitPolicy;
  /** How long stored items may be kept, if the platform limits it. */
  retentionDays?: number;
  /** Query the platform and return normalized candidates. */
  searchMentions(req: SearchRequest, ctx: SourceContext): Promise<SearchResult>;
  /** Cheap call proving the configured credentials work. */
  validateCredentials(ctx: SourceContext): Promise<void>;
}

/** Interface reserved for account-authorized sources (Milestones 5–6). */
export interface AuthorizedSourceAdapter {
  id: string;
  connect(input: { workspaceId: string; redirectUri: string }): Promise<{ authorizeUrl: string } | { connected: true }>;
  disconnect(input: { workspaceId: string; integrationId: string }): Promise<void>;
  validateCredentials(input: { workspaceId: string; integrationId: string }): Promise<void>;
  fetchMention(input: { workspaceId: string; externalId: string }): Promise<CandidateMention | null>;
  getIntegrationHealth(input: { workspaceId: string; integrationId: string }): Promise<{ status: "ok" | "degraded" | "error"; detail?: string }>;
}
