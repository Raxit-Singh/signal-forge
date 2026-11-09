// The public site's page lists: used by the top bar, the footer and the sitemap.

/** Public pages are indexed by search engines; everything else (the app) inherits the root layout's noindex. */
export const INDEXED = { index: true, follow: true } as const;

export const PRODUCT_PAGES = [
  { slug: "feedback-intelligence", name: "Feedback intelligence", line: "Mentions grouped into ranked bugs, requests and complaints" },
  { slug: "smart-monitoring", name: "Smart monitoring", line: "Busy places checked often, quiet ones less, history at setup" },
  { slug: "competitor-tracking", name: "Competitor tracking", line: "What people say about the products you compete with" },
  { slug: "buzz-analytics", name: "Buzz analytics and reports", line: "Volume, platforms, spikes and the reports in your inbox" },
  { slug: "mcp", name: "Heardex MCP", line: "Your feedback in Claude, ChatGPT, Cursor and VS Code" },
] as const;

export type ProductSlug = (typeof PRODUCT_PAGES)[number]["slug"];

export interface SiteLink { href: string; label: string }

/** The site's links by category. The footer and the phone menu both show these, so they can't drift apart. */
export const SITE_SECTIONS: ReadonlyArray<{ title: string; links: readonly SiteLink[] }> = [
  { title: "Product", links: [...PRODUCT_PAGES.map((p) => ({ href: `/product/${p.slug}`, label: p.name })), { href: "/#pricing", label: "Pricing" }] },
  { title: "Resources", links: [{ href: "/docs", label: "Docs" }, { href: "/blog", label: "Blog" }, { href: "/alternatives", label: "Alternatives" }, { href: "/#faq", label: "FAQ" }] },
  { title: "Support", links: [{ href: "/legal/contact", label: "Contact and support" }] },
  { title: "Legal", links: [{ href: "/legal/terms", label: "Terms of Service" }, { href: "/legal/privacy", label: "Privacy Policy" }, { href: "/legal/refunds", label: "Refund Policy" }] },
];
