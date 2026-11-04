// The public site's page lists: used by the top bar, the footer and the sitemap.

/** Public pages are indexed by search engines; everything else (the app) inherits the root layout's noindex. */
export const INDEXED = { index: true, follow: true } as const;

export const PRODUCT_PAGES = [
  { slug: "feedback-intelligence", name: "Feedback intelligence", line: "Mentions grouped into ranked bugs, requests and complaints" },
  { slug: "smart-monitoring", name: "Smart monitoring", line: "Busy places checked often, quiet ones less, history at setup" },
  { slug: "competitor-tracking", name: "Competitor tracking", line: "What people say about the products you compete with" },
  { slug: "buzz-analytics", name: "Buzz analytics and reports", line: "Volume, platforms, spikes and the reports in your inbox" },
  { slug: "claude", name: "Heardex for Claude", line: "Ask Claude about your feedback and investigate issues in code" },
] as const;

export type ProductSlug = (typeof PRODUCT_PAGES)[number]["slug"];

export const RESOURCE_LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/blog", label: "Blog" },
  { href: "/alternatives", label: "Alternatives" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
] as const;
