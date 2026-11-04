// The product pages (src/app/product/[slug]). Only what Heardex does today; which plans include what comes
// from the plans table through `plans()`, never typed in here.
import Link from "next/link";
import type { Plan } from "@/lib/domain/plans";
import type { ProductSlug } from "@/lib/marketing";
import type { SHOTS } from "@/components/marketing/shot";

const n = (v: number) => v.toLocaleString("en-US");
const every = (m: number) => (m >= 10080 ? "once a week" : m >= 1440 ? "once a day" : m >= 60 ? `every ${m / 60} hours` : `every ${m} minutes`);

export interface ProductPage {
  slug: ProductSlug;
  eyebrow: string;
  title: string;
  lede: string;
  blocks: Array<{ title: string; body: React.ReactNode }>;
  steps: string[];
  plans: (plans: Plan[]) => string[];
  limits: string[];
  docs: { href: string; label: string };
  /** A real screenshot of the app for the hero. */
  shot: keyof typeof SHOTS;
  /** The landing's animated clip (sample data) that shows the idea. */
  clip: "sort" | "feed" | "voice" | "spike" | "claude";
}

export const PRODUCT: ProductPage[] = [
  {
    slug: "feedback-intelligence",
    eyebrow: "Feedback intelligence",
    title: "From a pile of posts to a ranked list of what to fix.",
    lede: "Heardex reads every relevant mention, sorts it into bugs, feature requests and complaints, groups mentions of the same problem into one issue, and ranks the issues so the most important is at the top.",
    blocks: [
      { title: "Every mention, sorted", body: "Each relevant mention gets a sentiment and a category: bug report, feature request, usability, pricing or performance complaint, security concern, support question, praise, comparison with a competitor, or general talk. You can correct any of them, and the correction is kept." },
      { title: "Same problem, one issue", body: "Ten people describing the same crash in different words become one issue, with every report behind it, the platforms it came from, when it started and whether it's growing." },
      { title: "Ranked by evidence", body: "Priority starts from what was measured: how many people reported it, how fast it's growing and whether it keeps coming back. What the AI inferred, such as severity and the affected area, is shown separately so you can tell fact from guess." },
      { title: "Straight to the cause", body: <>On any issue, “Investigate with Claude” opens your own Claude with the issue and its reports. Claude reads them through the <Link href="/product/claude" className="hx-faq-link">Heardex connector</Link>, looks for the cause in your code and suggests a fix, asking before it changes anything.</> },
    ],
    steps: [
      "Heardex collects public mentions of your keywords and checks each one is really about your product.",
      "The AI classifies each relevant mention and groups similar ones into issues.",
      "Issues are ranked from measured facts; you mark them acknowledged, resolved or dismissed as you work through them.",
    ],
    plans: (plans) => {
      const on = plans.filter((p) => p.features.feedback_intelligence).map((p) => p.name);
      return [on.length ? `Included on ${on.join(", ")}.` : "Not on any public plan yet.", "The Free plan shows mentions and sentiment, without issue ranking."];
    },
    limits: [
      "Classification is done by AI and can be wrong; every issue links to the original posts so you can check.",
      "Issues need a few reports before they mean much; a single post stays a single post.",
    ],
    docs: { href: "/docs/issues", label: "How issues are built and ranked" },
    shot: "mentions",
    clip: "sort",
  },
  {
    slug: "smart-monitoring",
    eyebrow: "Smart monitoring",
    title: "Checked as often as it's worth checking.",
    lede: "Heardex learns how often each platform talks about you. Busy places are checked often, quiet ones less, so you hear about things quickly without paying for empty searches.",
    blocks: [
      { title: "Adapts per platform", body: "For every keyword and platform, Heardex estimates how often new posts arrive and sets the next check from that, within your plan's limits. A spike on Reddit doesn't make it search an empty corner of Stack Overflow more." },
      { title: "History from day one", body: "When you add a product you choose how far back to search: since launch, 7, 30, 90, 180 or 365 days, or a date, up to your plan's history. Heardex fills it in the background, so the dashboard isn't empty on the first day." },
      { title: "Honest about coverage", body: "Some platforms only return so much: LinkedIn search reaches the last 30 days, Apple's review feed the newest 500 reviews. Heardex records which time windows were read completely and labels partial periods instead of showing a smaller number as the truth." },
      { title: "Spikes you can trust", body: "Each day and hour is compared with its own baseline. A spike is marked confirmed only when the evidence is strong and the period was fully monitored; otherwise it says possible, or not enough data yet." },
    ],
    steps: [
      "Add your product, website and app store links, and the keywords people use for it.",
      "Pick how far back to search; history fills in while new mentions start arriving.",
      "Heardex keeps checking on its own; you can pause scanning and resume it at any time.",
    ],
    plans: (plans) => plans.map((p) => `${p.name}: ${p.monitoringIntervalMinutes >= 1440 ? `checked ${every(p.monitoringIntervalMinutes)}` : "checked as often as hourly"}, every keyword searched at least ${every(p.keywordRefreshTargetMinutes)}, ${n(p.historyDays)} days of history.`),
    limits: [
      "How often a keyword is searched is a target, not a guarantee: providers have their own limits.",
      "Paid platforms pause when your mentions for the month run out, and pick up again when the allowance renews.",
    ],
    docs: { href: "/docs/platforms", label: "Every platform, what's searched and how far back" },
    shot: "monitoring",
    clip: "feed",
  },
  {
    slug: "competitor-tracking",
    eyebrow: "Competitor tracking",
    title: "Hear what people say about the products you compete with.",
    lede: "Add a competitor by name and Heardex follows it on the same platforms as your product, so you can see where it's talked about, what people complain about and how it compares with you.",
    blocks: [
      { title: "Same platforms, same rules", body: "A competitor is searched like your own product: the same platforms, relevance checks and history." },
      { title: "One keyword per name", body: "Competitors share your plan's keywords: one keyword tracks one name. Their mentions count toward the same monthly allowance, so costs stay predictable." },
      { title: "Side by side", body: "Compare volume and platforms over time, and see the complaints about a competitor that your product could answer." },
    ],
    steps: [
      "Add the competitor's name, and website if it has one.",
      "Heardex searches for it with your next checks.",
      "Compare it with your product on the Competitors page.",
    ],
    plans: (plans) => {
      const on = plans.filter((p) => p.maxCompetitorsPerProduct > 0);
      return on.length ? on.map((p) => `${p.name}: up to ${p.maxCompetitorsPerProduct} competitor${p.maxCompetitorsPerProduct === 1 ? "" : "s"} per product, within ${n(p.maxKeywords)} keywords in total.`) : ["Not on any public plan yet."];
    },
    limits: ["A competitor takes keywords from your plan's total; a product needs at least one keyword of its own."],
    docs: { href: "/docs/keywords", label: "Keywords and competitors" },
    shot: "competitors",
    clip: "voice",
  },
  {
    slug: "buzz-analytics",
    eyebrow: "Buzz analytics and reports",
    title: "How much people talk about you, where, and what changed.",
    lede: "See mention volume, sentiment and platforms over time, find the spikes, and get a report every week without opening the app.",
    blocks: [
      { title: "Every number traceable", body: "Charts are built from stored mentions, so any number can be opened to the posts behind it. Periods that weren't fully monitored are labelled." },
      { title: "Spikes, explained", body: "When mentions jump, Heardex shows the spike with the posts that caused it and an explanation built from measured facts: which platform, which keyword, which posts." },
      { title: "Reports", body: "Every Monday a report on the week before lands in your inbox: volume, sentiment, top issues and notable posts. Paid plans add daily summaries. Reports can be printed and exported as CSV." },
      { title: "Notifications", body: "In-app notifications for spikes, a rise in negative sentiment, new bugs and growing feature requests." },
    ],
    steps: [
      "Open Buzz analytics and pick a date range.",
      "Filter by platform, keyword or sentiment, and open any point to see its mentions.",
      "Each person turns the Monday email on or off in Settings → Account.",
    ],
    plans: (plans) => [
      `Weekly reports on ${plans.filter((p) => p.features.weekly_reports).map((p) => p.name).join(", ")}.`,
      `Daily summaries on ${plans.filter((p) => p.features.daily_reports).map((p) => p.name).join(", ")}.`,
    ],
    limits: ["Spike detection needs a few days of monitoring before it can call anything confirmed."],
    docs: { href: "/docs/analytics", label: "Analytics, spikes and reports" },
    shot: "trends",
    clip: "spike",
  },
  {
    slug: "claude",
    eyebrow: "Heardex for Claude",
    title: "Ask Claude what users think, then let it find the fix.",
    lede: "Connect Heardex to Claude once and Claude can read your product's feedback and issues. Ask questions in plain words, or send an issue to Claude to look for the cause in your code.",
    blocks: [
      { title: "Ask in plain words", body: "“What are the top complaints this week?” “Summarize the bug reports and where they come from.” “Which platforms talk about us the most?” Claude answers from your real data, with links to the posts." },
      { title: "Investigate in your code", body: "“Investigate with Claude” on an issue gives Claude the issue, every report and its priority. In Claude Code it can then search your repository for the cause and suggest a fix. It asks before changing anything." },
      { title: "Read-only and revocable", body: "Claude sees only the workspace you approve and can't change anything in Heardex. You can see every connected Claude account and revoke access at once." },
      { title: "Works where you use Claude", body: "Claude on the web, the desktop app and Claude Code, on your own Claude plan. It uses the open Model Context Protocol (MCP), so other MCP clients that support remote servers can connect too." },
    ],
    steps: [
      "In Heardex, open Settings → Claude and click Connect.",
      "Approve access for your workspace.",
      "Ask Claude about your feedback, or click “Investigate with Claude” on an issue.",
    ],
    plans: () => ["Included on every plan, Free included."],
    limits: ["Claude usage counts toward your own Claude plan, not Heardex's."],
    docs: { href: "/docs/claude", label: "Connect Claude, Claude Code or Cursor" },
    shot: "claude",
    clip: "claude",
  },
];

export const productPage = (slug: string) => PRODUCT.find((p) => p.slug === slug);
