// Catalog of data sources. This is what onboarding and the Integrations page
// show; it must stay honest about what actually works today.

export type IntegrationProvider =
  | "github" | "youtube" | "hackernews" | "stackexchange"
  | "app_store_connect" | "google_play" | "discord"
  | "reddit" | "x" | "instagram" | "linkedin" | "facebook" | "slack" | "product_hunt";

/**
 * planned      – officially supported API, implementation scheduled (milestone noted)
 * available    – implemented and verified end-to-end
 * blocked      – needs commercial/partner approval or paid access we do not have
 */
export type Availability = "available" | "planned" | "blocked";

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
    availability: "available",
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
    availability: "planned",
    milestone: 6,
    publicDiscovery: false,
    requiresAuthorization: true,
    readOnly: true,
    dataAccessed: "Recent reviews of apps you manage.",
    permissions: "A service account you grant 'reply to reviews' / view access in Play Console.",
    limits: "The Play Developer API only returns reviews from roughly the last week, so history starts when you connect.",
  },
  {
    provider: "discord",
    name: "Discord",
    availability: "planned",
    milestone: 6,
    publicDiscovery: false,
    requiresAuthorization: true,
    readOnly: true,
    dataAccessed: "Messages in channels of servers you administer, only where the bot is given access.",
    permissions: "Bot install by a server admin; reading message content requires Discord's privileged intent.",
    limits: "Message Content intent requires Discord approval once the bot is in 100+ servers.",
  },
  ...(["reddit", "x", "instagram", "linkedin", "facebook", "slack", "product_hunt"] as const).map(
    (provider): IntegrationInfo => ({
      provider,
      name: {
        reddit: "Reddit", x: "X (Twitter)", instagram: "Instagram", linkedin: "LinkedIn",
        facebook: "Facebook", slack: "Slack", product_hunt: "Product Hunt",
      }[provider],
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
