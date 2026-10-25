// Catalog of data sources. This is what onboarding and the Integrations page
// show; it must stay honest about what actually works today.

export type IntegrationProvider =
  | "github" | "youtube" | "hackernews" | "stackexchange"
  | "app_store_connect" | "google_play"
  | "reddit" | "x" | "instagram" | "linkedin" | "facebook" | "slack" | "product_hunt"
  | "bluesky" | "dev" | "app_store" | "threads" | "tiktok" | "substack" | "web" | "news" | "trustpilot";

/**
 * available    – implemented and verified against the live API
 * unverified   – implemented and tested with recorded/mock responses; not yet
 *                validated live (needs credentials, and for paid sources an
 *                authorized test budget)
 * planned      – officially supported API, implementation scheduled (milestone noted)
 * blocked      – needs commercial/partner approval or access we do not have
 */
export type Availability = "available" | "unverified" | "planned" | "blocked";

export interface IntegrationInfo {
  provider: IntegrationProvider;
  name: string;
  availability: Availability;
  milestone?: number;
  publicDiscovery: boolean;     // finds public mentions by keyword
  requiresAuthorization: boolean; // user must connect an account / app
  readOnly: boolean;
  dataAccessed: string;
  permissions: string;
  limits: string;
  blockedReason?: string;
  /** Collected through API Direct (paid per request). */
  paid?: boolean;
  /** Comments: found by global search, only on selected posts, or not at all. */
  commentCoverage?: "search" | "selected_posts" | "none";
}

export const INTEGRATIONS: readonly IntegrationInfo[] = [
  {
    provider: "hackernews",
    name: "Hacker News",
    availability: "available",
    publicDiscovery: true,
    requiresAuthorization: false,
    readOnly: true,
    dataAccessed: "Public stories and comments that match your keywords, with points and comment counts.",
    permissions: "None — uses the public HN search API.",
    limits: "Public API; SignalForge rate-limits itself to stay well inside fair use.",
  },
  {
    provider: "github",
    name: "GitHub",
    availability: "available",
    publicDiscovery: true,
    requiresAuthorization: false,
    readOnly: true,
    dataAccessed:
      "Public GitHub issues that mention your product. Later: issues and code in repositories you explicitly grant (Milestone 5).",
    permissions:
      "Public search needs no access to your account. Repository connection uses a GitHub App with read-only Issues, Metadata and Contents permissions on repositories you select.",
    limits: "Issues only (not pull requests or comments). Search API: 30 requests/minute with a token, at most 1,000 results per query.",
  },
  {
    provider: "youtube",
    name: "YouTube",
    availability: "unverified",
    commentCoverage: "selected_posts",
    publicDiscovery: true,
    requiresAuthorization: false,
    readOnly: true,
    dataAccessed: "Public videos matching your keywords, their statistics, and public comments on those videos.",
    permissions: "None — uses the YouTube Data API with SignalForge's own key.",
    limits:
      "YouTube allows 100 keyword searches per day for all SignalForge customers combined, so each product is searched at most once a day (newest 50 videos). Stored YouTube data is kept for 30 days.",
  },
  {
    provider: "stackexchange",
    name: "Stack Overflow / Stack Exchange",
    availability: "available",
    publicDiscovery: true,
    requiresAuthorization: false,
    readOnly: true,
    dataAccessed: "Public Stack Overflow questions and answers that mention your product.",
    permissions: "None — uses the public Stack Exchange API.",
    limits: "Daily request quota per app key; the API's backoff instructions are honoured.",
  },
  {
    provider: "app_store_connect",
    name: "App Store Connect",
    availability: "planned",
    milestone: 6,
    publicDiscovery: false,
    requiresAuthorization: true,
    readOnly: true,
    dataAccessed: "Customer reviews of apps you own.",
    permissions: "An App Store Connect API key you create with the minimum role that can read customer reviews.",
    limits: "Only apps in your own developer account.",
  },
  {
    provider: "google_play",
    name: "Google Play",
    availability: "unverified",
    publicDiscovery: false,
    requiresAuthorization: true,
    readOnly: true,
    dataAccessed: "Reviews of the Android app on your product (its Google Play URL), from your own Play Console.",
    permissions: "A Google Cloud service account you create and invite in Play Console with permission to view app information; read-only API scope.",
    limits: "Google's Play Developer API only returns reviews with text from about the last week, so history starts when you connect.",
  },
  {
    provider: "bluesky",
    name: "Bluesky",
    availability: "available",
    publicDiscovery: true,
    requiresAuthorization: false,
    readOnly: true,
    commentCoverage: "search",
    dataAccessed: "Public Bluesky posts and replies that contain your keywords.",
    permissions: "None — uses Bluesky's public search API (AT Protocol AppView).",
    limits: "One search per keyword (Bluesky search has no OR). Search covers what Bluesky has indexed; it is not a complete archive.",
  },
  {
    provider: "dev",
    name: "DEV Community",
    availability: "available",
    publicDiscovery: true,
    requiresAuthorization: false,
    readOnly: true,
    commentCoverage: "selected_posts",
    dataAccessed: "DEV articles tagged with one of your keywords, and comments on the relevant ones.",
    permissions: "None — uses the public Forem API.",
    limits: "DEV's API has no full-text search, so only articles *tagged* with a keyword are found.",
  },
  {
    provider: "app_store",
    name: "Apple App Store reviews",
    availability: "available",
    publicDiscovery: false,
    requiresAuthorization: false,
    readOnly: true,
    dataAccessed: "Recent public customer reviews of your app (the App Store URL on your product).",
    permissions: "None — uses Apple's public customer-reviews feed.",
    limits: "Most recent reviews only, per storefront; no per-review links.",
  },
  ...([
    ["reddit", "Reddit", "search", "Public posts and comments that mention your keywords — comments are searched directly, even when the post doesn't mention you.", "Comment results link to the thread: the API returns no comment permalink."],
    ["x", "X (Twitter)", "selected_posts", "Public posts, replies and quote posts that contain your keywords; replies to selected high-engagement posts.", "Search finds replies that mention you; other replies are only read on selected posts."],
    ["linkedin", "LinkedIn", "none", "Public LinkedIn posts that mention your keywords.", "Posts only — comments are not available."],
    ["tiktok", "TikTok", "selected_posts", "Public TikTok videos matching your keywords, and comments on selected relevant videos.", "Keyword search matches loosely; comments are only read on selected videos (TikTok shows about 450 per video)."],
    ["instagram", "Instagram", "selected_posts", "Public Instagram posts matching your keywords, and comments on selected relevant posts.", "Search is relevance-ranked with no date filter, so new posts can be missed."],
    ["facebook", "Facebook", "selected_posts", "Public Facebook posts matching your keywords, and comments on selected relevant posts.", "Every keyword word must appear; comments only on selected posts."],
    ["substack", "Substack", "none", "Substack posts and Notes that mention your keywords.", "Post search is relevance-ranked; only the preview text is stored."],
    ["web", "Web (Google Search)", "none", "Web pages Google returns for your keywords.", "Search snippets only; pages have no publication date, so they are left out of trend charts."],
    ["news", "News (Google News)", "none", "News articles that mention your keywords; syndicated copies are linked.", "Snippets only, up to 50 articles per check."],
    ["trustpilot", "Trustpilot", "none", "Reviews on your company's Trustpilot page (from your product's website domain).", "Only your own business page; nothing is found if Trustpilot has no page for your domain."],
  ] as const).map(([provider, name, commentCoverage, dataAccessed, limits]): IntegrationInfo => ({
    provider,
    name,
    availability: "unverified",
    paid: true,
    commentCoverage,
    publicDiscovery: true,
    requiresAuthorization: false,
    readOnly: true,
    dataAccessed,
    permissions: "None from you — collected through API Direct, SignalForge's paid data provider.",
    limits: `${limits} Paid source: runs only when your plan includes paid sources and a spending limit is set.`,
  })),
  {
    provider: "threads",
    name: "Threads",
    availability: "blocked",
    publicDiscovery: false,
    requiresAuthorization: true,
    readOnly: true,
    dataAccessed: "—",
    permissions: "—",
    limits: "—",
    blockedReason: "Keyword search needs Meta's threads_keyword_search permission, which requires app review. Disabled until approved.",
  },
  ...(["slack", "product_hunt"] as const).map(
    (provider): IntegrationInfo => ({
      provider,
      name: { slack: "Slack", product_hunt: "Product Hunt" }[provider],
      availability: "blocked",
      publicDiscovery: false,
      requiresAuthorization: true,
      readOnly: true,
      dataAccessed: "—",
      permissions: "—",
      limits: "—",
      blockedReason:
        provider === "slack"
          ? "Planned as a notification channel; reading workspaces you don't administer is not possible."
          : "Commercial API access or partner approval is required. SignalForge will not scrape this platform.",
    }),
  ),
];

export function integrationInfo(provider: IntegrationProvider): IntegrationInfo | undefined {
  return INTEGRATIONS.find((i) => i.provider === provider);
}
