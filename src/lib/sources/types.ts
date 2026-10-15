// Common contract for every data source. Framework-free so it can be unit
// tested with `node --test` and deterministic fixtures.

/** Free official sources from Milestone 2. */
export type LegacySourceId = "hackernews" | "github" | "stackexchange" | "youtube";
/** Free official sources added in Milestone 2.5. */
export type OfficialSourceId = LegacySourceId | "bluesky" | "dev" | "app_store";
/** Platforms collected through API Direct (paid, pay-as-you-go). */
export type PaidSourceId =
  | "reddit" | "x" | "linkedin" | "tiktok" | "instagram" | "facebook" | "substack" | "web" | "news" | "trustpilot";
/** Every keyword-searchable source SignalForge can run. Values match the `integration_provider` enum. */
export type PublicSourceId = OfficialSourceId | PaidSourceId;

export type MentionType = "post" | "comment" | "reply" | "quote" | "video" | "review" | "article" | "note" | "community_message";
export type CollectionMethod =
  | "keyword_search" | "comment_search" | "comment_expansion" | "reply_expansion" | "quote_expansion" | "review_feed" | "tag_feed";
/** What a stored link opens. */
export type LinkTarget = "item" | "thread" | "shared_content" | "listing";
export type DataProvider = "official" | "apidirect";
export type SpendPurpose =
  | "search" | "comment_search" | "comment_expansion" | "reply_expansion" | "quote_expansion" | "review_fetch" | "audit" | "live_test";

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
  /** Stream of a multi-stream source (e.g. Reddit "posts" / "comments"). Defaults to "default". */
  stream?: string;
  /** Pre-built query expression from the optimizer; adapters use it instead of building from `terms`. */
  query?: string;
  /** Product facts some sources need (Trustpilot domain, App Store app id). */
  target?: { websiteDomain?: string | null; appStoreId?: string | null; appStoreCountry?: string | null };
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
  /** Defaults: "post", "keyword_search", "item", "official". */
  mentionType?: MentionType;
  collectionMethod?: CollectionMethod;
  linkTarget?: LinkTarget;
  dataProvider?: DataProvider;
  /** Subreddit, publication, news outlet, server... */
  community?: string | null;
  /** True when the source gives no publication time and discovery time was used. */
  publishedAtEstimated?: boolean;
  /**
   * Items that are about the product by construction (reviews of its own app or
   * business page). Skips keyword matching; the reason is stored as the match.
   */
  directlyAbout?: { reason: string; score: number };
  /** Paid request (ledger id) that returned this item, for per-request accounting. */
  originRequestId?: string | null;
}

export interface RateLimitSnapshot {
  remaining?: number;
  limit?: number;
  resetAt?: string;
}

export interface SearchResult {
  items: CandidateMention[];
  /** Page caps were hit with full pages: more results probably exist (adaptive engine shortens the interval). */
  saturated?: boolean;
  /** Pages requested from the source, for efficiency reporting. */
  pagesRequested?: number;
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
  /** Present for paid calls: budget is reserved before the request and settled after it. */
  billing?: BillingIntent;
}

export interface BillingIntent {
  /** Key in the `provider_pricing` registry, e.g. "reddit.comments". */
  pricingKey: string;
  /** Units the provider will bill if the request is answered (pages requested, or 1). */
  units: number;
  purpose: SpendPurpose;
}

/** What the provider's billing rules say about an answered/failed request. */
export interface BillingOutcome {
  billedUnits: number;
  errorCode?: string | null;
  results?: number | null;
}

export interface PaidResponse {
  response: Response;
  /** Ledger row of this request (for attributing results to it). */
  ledgerId: string | null;
  /** Report the outcome; must be called exactly once per paid request. */
  settle(outcome: BillingOutcome): Promise<void>;
}

export interface SourceContext {
  /** Rate-limited, usage-recorded HTTP GET. Throws SourceError on limiter refusal. */
  request(req: SourceRequest): Promise<Response>;
  /**
   * Paid HTTP GET: reserves budget first (throws SourceError "budget" when refused),
   * then performs the request. The caller settles with the provider's billing outcome.
   */
  paidRequest(req: SourceRequest & { billing: BillingIntent }): Promise<PaidResponse>;
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
export interface QueryCapabilities {
  /** Boolean OR between terms, and its syntax. */
  booleanOr: false | "OR" | "|";
  /** Parentheses + AND, so an ambiguous term can be tied to context terms. */
  grouping: boolean;
  exactPhrase: boolean;
  maxQueryLength: number;
  /** Most terms one query may combine. */
  maxTerms: number;
  /** "range": exact since/until; "preset": coarse posted_ago buckets; "none": client-side only. */
  dateFilter: "range" | "preset" | "none";
  /** Results can be ordered newest-first (needed for incremental collection). */
  sortNewest: boolean;
  pagination: "page" | "pages" | "cursor" | "limit" | "none";
  /** Most pages one run may request (cost/quota guard). */
  maxPagesPerRun: number;
  /** Keywords match as substrings/words of longer phrases, so "FocusFlow review" is covered by "FocusFlow". */
  wordMatch: boolean;
}

export interface StreamSpec {
  id: string;
  label: string;
  mentionType: MentionType;
  capabilities: QueryCapabilities;
  /** How queries are built: from keywords, one per product (reviews of the product itself), or not at all. */
  queryMode: "keywords" | "product";
}

/** A parent post/video whose comments may be worth fetching. */
export interface ExpansionParent {
  externalId: string;
  /** Platform id used by the comments endpoint (tweet id, video id, shortcode, post id). */
  platformId: string;
  sourceUrl: string;
  title: string | null;
  commentCount: number;
  publishedAt: Date;
}

export interface SourceAdapter {
  id: PublicSourceId;
  name: string;
  dataProvider?: DataProvider;
  /** Every call costs money (API Direct). */
  paid?: boolean;
  /** Identical public queries from different products may share one upstream fetch. */
  shareable?: boolean;
  /** Streams with separate checkpoints. Legacy sources have a single "default" stream. */
  streams?: StreamSpec[];
  /** Comments on selected parents (platforms without global comment search). */
  expandComments?(parents: ExpansionParent[], ctx: SourceContext, signal?: AbortSignal): Promise<SearchResult>;
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
