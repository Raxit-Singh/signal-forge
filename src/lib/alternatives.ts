// Comparison pages (src/app/alternatives). Every fact about another company comes from its own public pages,
// checked on CHECKED; `source` links the page each one was read from. Say only what those pages say: a feature
// a page doesn't mention is "not listed", never "missing". Heardex's prices come from the plans table, not from here.

export const CHECKED = "4 November 2026";

export interface Competitor {
  slug: string;
  name: string;
  /** What it is, in their terms. */
  kind: string;
  /** One sentence: how it differs from Heardex. */
  summary: string;
  facts: {
    price: string;
    trial: string;
    billing: string;
    entry: string;
    overLimit: string;
    sources: string;
    extras: string;
    builtFor: string;
  };
  /** Where they're the better choice. Honest: this is what makes the page believable. */
  stronger: string[];
  /** Where Heardex is different (true of Heardex; no claims about them beyond `facts`). */
  different: string[];
  pickThem: string;
  pickUs: string;
  source: { label: string; href: string }[];
  /** Shown above the comparison, e.g. a product that has shut down. */
  notice?: string;
}

const NOT_LISTED = "Not listed on their pricing page";

export const COMPETITORS: Competitor[] = [
  {
    slug: "octolens",
    name: "Octolens",
    kind: "Social listening for the agent era",
    summary: "Octolens is a broad social listening tool with an API and webhooks; Heardex is built for product teams who want mentions turned into ranked bugs, requests and complaints, from a lower price.",
    facts: {
      price: "Pro $159/month, Scale $499/month, billed annually",
      trial: "7-day trial with Pro features, up to 5,000 mentions, no card",
      billing: "Annual billing shown; monthly toggle offered (annual saves up to 20%)",
      entry: "Pro: 10 keywords, 15,000 mentions a month, hourly refresh",
      overLimit: "Extra mentions billed at $0.013 each on Pro (a monthly spend cap can be set)",
      sources: "Reddit, Bluesky, DEV, LinkedIn, X, TikTok, Hacker News, YouTube, GitHub, Stack Overflow and reviews on Pro; podcasts, newsletters, news and web from Scale",
      extras: "API, webhooks, MCP server, Slack and email alerts, AI relevance scoring, tagging and sentiment, unlimited seats",
      builtFor: "Teams monitoring their brand and competitors",
    },
    stronger: [
      "An API, webhooks and Slack alerts on every plan. Heardex doesn't offer these yet.",
      "Podcasts and newsletters as sources (on Scale and up).",
      "More keywords and mentions on its entry plan, and real-time refresh on Scale.",
    ],
    different: [
      "Starts lower: a free plan, then paid plans from the monthly price below, billed monthly or yearly.",
      "No overage charges. When your mentions for the month run out, new ones are held, not billed.",
      "Groups mentions of the same problem into one issue and ranks issues, so you see what to fix first.",
      "News and the wider web are on every paid plan, not only the higher ones.",
    ],
    pickThem: "You need an API or webhooks today, or podcast and newsletter coverage.",
    pickUs: "You're a product team that wants to know what users complain about and ask for, without paying per extra mention.",
    source: [{ label: "octolens.com/pricing", href: "https://octolens.com/pricing" }],
  },
  {
    slug: "brand24",
    name: "Brand24",
    kind: "Media and social monitoring",
    summary: "Brand24 covers a wide range of consumer channels for marketing and PR teams; Heardex focuses on what users say about software products, from a much lower entry price.",
    facts: {
      price: "Individual $249/month ($199/month billed yearly); Team $349 ($299); Pro $499 ($399); Business $699 ($599)",
      trial: "14-day free trial, no card",
      billing: "Monthly or yearly",
      entry: "Individual: 3 keywords, 2,000 mentions a month, updates every 12 hours, 1 user",
      overLimit: "Overage fees beyond the monthly limit (rates not listed on the page)",
      sources: "Facebook, Instagram, X, news, blogs, Reddit, LinkedIn, Medium, Quora, YouTube, TikTok, reviews, Twitch, newsletters, podcasts",
      extras: "AI sentiment on every plan; AI brand assistant, insights and topics from Pro; API $149 extra",
      builtFor: "Marketing, PR and brand teams",
    },
    stronger: [
      "More consumer channels, including podcasts, newsletters, Twitch, Medium and Quora.",
      "Real-time updates on its Pro plan and up, and unlimited users from Team.",
      "A longer track record and larger AI toolset for brand and PR reporting.",
    ],
    different: [
      "Paid plans start far lower, and there's a free plan.",
      "Searches the places software users talk directly: Hacker News, GitHub, Stack Overflow, DEV and app store reviews.",
      "No overage charges: mentions past your allowance are held, not billed.",
      "Ranks what users say into bugs, feature requests and complaints.",
    ],
    pickThem: "You run brand or PR monitoring across consumer channels and media.",
    pickUs: "You build software and want product feedback from developer and user communities at a small-team price.",
    source: [{ label: "brand24.com/prices", href: "https://brand24.com/prices/" }],
  },
  {
    slug: "awario",
    name: "Awario",
    kind: "Social listening and brand monitoring",
    summary: "Awario offers high mention volumes for the price with Boolean search and white-label reports; Heardex trades volume for product focus: developer sources and mentions sorted into issues.",
    facts: {
      price: "Starter $49/month ($29 billed yearly); Pro $149 ($89); Enterprise $399 ($249)",
      trial: "Free trial of Starter, up to 3 alerts and 30,000 mentions, no card",
      billing: "Monthly or yearly (yearly saves up to 40%)",
      entry: "Starter: 3 topics, unlimited keywords per topic, 30,000 new mentions a month, 1 user",
      overLimit: NOT_LISTED,
      sources: "Their site has monitoring pages for Reddit, Instagram, X, Facebook, YouTube, Vimeo and news",
      extras: "Boolean search, PDF and white-label reports, API access",
      builtFor: "Marketers, agencies and brand monitoring",
    },
    stronger: [
      "A lower entry price and far more mentions per dollar.",
      "Boolean search and white-label reports, useful for agencies.",
      "API access listed on its plans.",
    ],
    different: [
      "Searches Hacker News, GitHub, Stack Overflow, DEV and app store reviews, where software users report problems.",
      "Groups mentions into ranked bugs, feature requests and complaints, instead of a feed to read through.",
      "A Claude MCP connector on every plan: ask Claude about your mentions in plain words.",
      "A free plan you can keep using, not only a trial.",
    ],
    pickThem: "You need lots of mentions cheaply, Boolean queries or client-ready white-label reports.",
    pickUs: "You want to know what to fix and build next in a software product.",
    source: [{ label: "awario.com/pricing", href: "https://awario.com/pricing/" }],
  },
  {
    slug: "mention",
    name: "Mention",
    kind: "Media monitoring and social listening",
    summary: "Mention is a brand monitoring platform with review sites and team tools; Heardex publishes its prices and focuses on product feedback for software.",
    facts: {
      price: "One Company plan; the amount isn't shown on the pricing page",
      trial: "Free trial offered (length not stated)",
      billing: "Monthly or yearly (yearly: 2 months free)",
      entry: NOT_LISTED,
      overLimit: NOT_LISTED,
      sources: "Facebook, Instagram, X, Reddit, TikTok, Pinterest, YouTube, news, blogs, forums and 75+ review sites",
      extras: "Sentiment, competitor benchmarking, share of voice, Slack and Zapier integrations; API and historical data are paid add-ons",
      builtFor: "Marketing and communications teams",
    },
    stronger: [
      "75+ review sites, including Google, Amazon and Glassdoor.",
      "Slack and Zapier integrations, and a dedicated account manager.",
      "Pinterest and forum coverage.",
    ],
    different: [
      "Prices are public, with a free plan to start.",
      "Searches Hacker News, GitHub, Stack Overflow and DEV, where developers talk about tools.",
      "Ranks mentions into bugs, feature requests and complaints.",
      "A year of history on every paid plan (two on Scale), with no add-on to buy.",
    ],
    pickThem: "You need review-site coverage across many industries and managed onboarding.",
    pickUs: "You're a software team and want transparent pricing and product feedback in one place.",
    source: [{ label: "mention.com/en/pricing", href: "https://mention.com/en/pricing/" }],
  },
  {
    slug: "sprout-social",
    name: "Sprout Social",
    kind: "Social media management",
    summary: "Sprout Social is a full social media management suite where listening is an add-on; Heardex is only listening, built around product feedback.",
    facts: {
      price: "Essentials $79/seat/month billed yearly ($99 monthly); Standard $199/seat; Professional $299/seat; Advanced $399/seat",
      trial: "30-day free trial, no card",
      billing: "Monthly or yearly, per seat",
      entry: "Listening isn't in any plan: it's a paid add-on from Standard up (price by demo)",
      overLimit: NOT_LISTED,
      sources: NOT_LISTED,
      extras: "Publishing, engagement inbox, analytics and reporting; Premium Analytics and Listening add-ons",
      builtFor: "Social media and marketing teams",
    },
    stronger: [
      "Scheduling, publishing and replying to social posts, which Heardex doesn't do.",
      "Team workflows and reporting for social media managers.",
    ],
    different: [
      "Listening is the product, not an add-on, and the price is public.",
      "No per-seat pricing: invite your team at no extra cost.",
      "Searches developer communities and app store reviews.",
      "Ranks what users say into bugs, feature requests and complaints.",
    ],
    pickThem: "You need to publish and manage social accounts, with listening on top.",
    pickUs: "You only need to hear what users say about your product, and act on it.",
    source: [{ label: "sproutsocial.com/pricing", href: "https://sproutsocial.com/pricing/" }],
  },
  {
    slug: "hootsuite",
    name: "Hootsuite",
    kind: "Social media management",
    summary: "Hootsuite is a social media management platform with listening built in at basic levels and advanced listening on Enterprise; Heardex is a listening tool for product teams.",
    facts: {
      price: "Paid plans from $99 to $399/month billed yearly (per their FAQ); Enterprise custom",
      trial: "14-day free trial on Standard, Professional and Advanced",
      billing: "Monthly or yearly (yearly is cheaper per user)",
      entry: "Standard: brand and competitor monitoring; Professional adds Quick Search of the last 30 days",
      overLimit: NOT_LISTED,
      sources: "Advanced data sources and review monitoring on Enterprise",
      extras: "Publishing and scheduling, inbox, analytics; advanced listening on Enterprise",
      builtFor: "Social media teams",
    },
    stronger: [
      "Publishing, scheduling and an engagement inbox for your own social accounts.",
      "Enterprise-grade listening with 13 months of history for large teams.",
    ],
    different: [
      "Keyword search across Hacker News, GitHub, Stack Overflow, DEV and app store reviews on every plan.",
      "A year of history from the first paid plan, two years on Scale.",
      "Ranks mentions into bugs, feature requests and complaints.",
      "A free plan and paid plans from the monthly price below.",
    ],
    pickThem: "You manage social accounts and want listening in the same tool.",
    pickUs: "You want product feedback from where software users actually post.",
    source: [{ label: "hootsuite.com/plans", href: "https://www.hootsuite.com/plans" }],
  },
  {
    slug: "brandwatch",
    name: "Brandwatch",
    kind: "Consumer intelligence and social media management",
    summary: "Brandwatch is an enterprise consumer intelligence suite sold by demo; Heardex is self-serve, priced in public and focused on software products.",
    facts: {
      price: "Not public: sold through a demo",
      trial: "Demo",
      billing: "By agreement",
      entry: NOT_LISTED,
      overLimit: NOT_LISTED,
      sources: "Broad consumer and social data for market research",
      extras: "Consumer Intelligence, social media management, influencer marketing, search intelligence, Iris AI",
      builtFor: "Enterprise research, marketing, PR and agencies",
    },
    stronger: [
      "Depth for market research across a very large data set.",
      "Influencer marketing and social media management in the same suite.",
      "Analysts and consultants available.",
    ],
    different: [
      "Sign up and start in minutes; no demo or contract.",
      "Prices are public, with a free plan.",
      "Made for software teams: developer communities and app store reviews included.",
      "Ranks what users say into bugs, feature requests and complaints.",
    ],
    pickThem: "You're an enterprise doing consumer research across markets.",
    pickUs: "You're a startup or product team and want answers this week, not after a sales cycle.",
    source: [{ label: "brandwatch.com", href: "https://www.brandwatch.com/" }],
  },
  {
    slug: "meltwater",
    name: "Meltwater",
    kind: "Media intelligence and social listening",
    summary: "Meltwater sells media intelligence on annual contracts with tailored pricing; Heardex is self-serve, month to month if you like, and built for product feedback.",
    facts: {
      price: "Not public: tailored quotes",
      trial: "No self-serve trial; guided demo",
      billing: "Mostly annual contracts, 12-month minimum",
      entry: "Starter: media intelligence, social listening, AI visibility tracking, media relations",
      overLimit: NOT_LISTED,
      sources: "Coverage depends on the sources and regions chosen",
      extras: "Mira AI, media relations, influencer marketing on higher plans, API and MCP on Enterprise and Agency",
      builtFor: "Communications, PR and marketing teams",
    },
    stronger: [
      "Media relations and press coverage tracking for PR teams.",
      "24/7 support and global coverage choices.",
    ],
    different: [
      "No contract: pay monthly or yearly, and cancel any time.",
      "Public prices and a free plan.",
      "A Claude MCP connector on every plan, not only the top ones.",
      "Ranks what users say into bugs, feature requests and complaints.",
    ],
    pickThem: "You're a PR or comms team tracking press and media worldwide.",
    pickUs: "You want product feedback without an annual contract.",
    source: [{ label: "meltwater.com/en/pricing", href: "https://www.meltwater.com/en/pricing" }],
  },
  {
    slug: "google-alerts",
    name: "Google Alerts",
    kind: "Email alerts for new Google Search results",
    summary: "Google Alerts emails you new Google Search results for a phrase; Heardex searches social platforms and communities directly and sorts what it finds.",
    facts: {
      price: "Free",
      trial: "Free",
      billing: "Free",
      entry: "Alerts for any search phrase",
      overLimit: "None",
      sources: "New results in Google Search (you can choose site types, language and region)",
      extras: "Email delivery at the frequency you choose",
      builtFor: "Anyone following a topic or name",
    },
    stronger: ["It's free.", "It covers whatever Google indexes, for any topic."],
    different: [
      "Searches Reddit, X, LinkedIn, Hacker News, GitHub, Bluesky, app store reviews and more directly, not only indexed pages.",
      "Each mention is stored once, with relevance, so you're not reading the same thing twice.",
      "Ranks mentions into bugs, feature requests and complaints, with trends over time.",
      "Its free plan already covers Hacker News, GitHub, Stack Overflow, Bluesky, DEV and app store reviews.",
    ],
    pickThem: "You want a free email when a phrase appears on the web.",
    pickUs: "You want to see what users say about your product across communities, sorted into what to act on.",
    source: [{ label: "Google Alerts help", href: "https://support.google.com/websearch/answer/4815696" }],
  },
  {
    slug: "common-room",
    name: "Common Room",
    kind: "Buyer intelligence for sales and go-to-market",
    summary: "Common Room finds buyers and accounts for sales teams; Heardex listens to what users say about your product, for the people building it.",
    facts: {
      price: "Essential $2,500/month billed yearly; Advanced and Enterprise custom",
      trial: NOT_LISTED,
      billing: "Yearly",
      entry: "Essential: 5 seats, up to 100k contacts, AI research and prospecting credits",
      overLimit: NOT_LISTED,
      sources: "Website visits, intent topics, job changes, social and community engagement, product signals (add-on)",
      extras: "Buyer and account views, AI scoring, workflows, CRM and Slack integrations, MCP server",
      builtFor: "Sales and go-to-market teams",
    },
    stronger: [
      "Buyer and account intelligence: who is visiting, who changed jobs, who is in market.",
      "CRM workflows and prospecting for sales teams.",
    ],
    different: [
      "A different job: what users say about your product, not who to sell to.",
      "A small fraction of the price, with a free plan.",
      "Ranks mentions into bugs, feature requests and complaints for product teams.",
    ],
    pickThem: "You're a sales or GTM team looking for buyers.",
    pickUs: "You're building the product and want to hear what users think of it.",
    source: [{ label: "commonroom.io/pricing", href: "https://www.commonroom.io/pricing/" }],
  },
  {
    slug: "trigify",
    name: "Trigify",
    kind: "Signals for go-to-market teams",
    summary: "Trigify is shutting down. If you used it to follow social conversations, Heardex keeps listening across platforms.",
    notice: "Trigify announced it is closing: standard customers' access ended on 22 October 2026, and monitoring, signal collection, integrations and API access stop when access ends.",
    facts: {
      price: "Retired",
      trial: "Retired",
      billing: "Retired",
      entry: "Retired",
      overLimit: "Retired",
      sources: "Retired",
      extras: "Monitoring, signal collection, integrations and API, ending with access",
      builtFor: "Go-to-market and revenue teams",
    },
    stronger: ["It was built around sales signals for revenue teams, which Heardex isn't."],
    different: [
      "Keeps monitoring social platforms and communities for your keywords: LinkedIn, X, Reddit and more on paid plans.",
      "Self-serve: sign up and set keywords in a few minutes, with a free plan.",
      "Ranks what people say about your product into bugs, feature requests and complaints.",
    ],
    pickThem: "Trigify is no longer available.",
    pickUs: "You need to keep hearing what people say about your product or your competitors.",
    source: [{ label: "trigify.io", href: "https://www.trigify.io/pricing" }],
  },
];

export const competitor = (slug: string) => COMPETITORS.find((c) => c.slug === slug);
