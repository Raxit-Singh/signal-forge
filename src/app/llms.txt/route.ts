// /llms.txt (https://llmstxt.org): a plain-text guide to Heardex for AI models, built from the same content as the
// site, so it never drifts from it. Prices and limits come from the plans table, like every other page.
import { createClient } from "@/lib/supabase/server";
import { formatPrice, intervalPrice, planFromRow, type PlanRow } from "@/lib/domain/plans";
import { resourceUrl } from "@/lib/agent/oauth";
import { site } from "@/lib/server/agent/http";
import { PRODUCT_PAGES } from "@/lib/marketing";
import { DOCS, FREE_PLATFORMS, PAID_PLATFORMS } from "@/content/docs";
import { POSTS } from "@/content/blog";
import { COMPETITORS } from "@/lib/alternatives";
import { LEGAL } from "@/lib/legal";

const n = (v: number) => v.toLocaleString("en-US");

export async function GET() {
  const base = site();
  const { data } = await (await createClient()).from("plans").select("*").eq("is_public", true).order("sort_order");
  const plans = (data ?? []).map((r) => planFromRow(r as PlanRow)).filter((p) => !p.retired);
  const link = (path: string, title: string, about?: string) => `- [${title}](${base}${path})${about ? `: ${about}` : ""}`;

  const planLines = plans.map((p) => {
    const price = p.priceCentsMonthly
      ? `${formatPrice(p.priceCentsMonthly, p.currency)}/month${p.priceCentsYearly ? ` or ${formatPrice(intervalPrice(p, "year").perMonthCents, p.currency)}/month billed yearly` : ""}`
      : "free, no card";
    return `- ${p.name}: ${price}; ${n(p.maxKeywords)} keyword${p.maxKeywords === 1 ? "" : "s"}, ${n(p.monthlyMentionLimit)} mentions a month, ${n(p.historyDays)} days of history${p.maxCompetitorsPerProduct ? `, up to ${p.maxCompetitorsPerProduct} competitors per product` : ""}`;
  });

  const text = [
    "# Heardex",
    "",
    "> Heardex is social listening and product intelligence for software teams. It finds public posts that mention a product across Reddit, Hacker News, GitHub, Stack Overflow, app store reviews, X, LinkedIn and more, checks each one is really about that product, sorts them into bug reports, feature requests, complaints and testimonials, groups posts about the same problem into issues, and ranks the issues. Teams can ask Claude about their feedback through the Heardex MCP connector.",
    "",
    "Key facts:",
    "",
    "- Built for software and product teams; used in the browser at " + base + ".",
    "- One keyword tracks one name: the product, a variation of it, or a competitor. Competitors share the plan's keywords.",
    "- Only new, relevant, unique public posts count as mentions. When the month's mentions run out, new ones are held and paid sources pause; there are no overage charges and plans never upgrade on their own.",
    "- Issue ranking starts from measured facts (how many people reported it, whether it is growing, whether it recurs); AI inferences such as severity are shown separately.",
    "- Payments are handled by Dodo Payments as merchant of record. Billing is monthly or yearly; cancel any time.",
    `- Every plan includes the read-only Claude MCP connector at ${resourceUrl(base)}.`,
    "- Prices are in US dollars and come from the live plans:",
    ...planLines,
    "",
    "## Product",
    "",
    ...PRODUCT_PAGES.map((p) => link(`/product/${p.slug}`, p.name, p.line)),
    link("/#pricing", "Pricing", "plans, prices and what each includes"),
    "",
    "## Docs",
    "",
    ...DOCS.map((d) => link(d.slug ? `/docs/${d.slug}` : "/docs", d.title, d.description)),
    "",
    "## Platforms",
    "",
    "On every plan:",
    ...FREE_PLATFORMS.map(([p, what, back]) => `- ${p}: ${what}; ${back.charAt(0).toLowerCase()}${back.slice(1)}`),
    "",
    "On paid plans:",
    ...PAID_PLATFORMS.map(([p, what, back]) => `- ${p}: ${what}; ${back.charAt(0).toLowerCase()}${back.slice(1)}`),
    "",
    "## Comparisons",
    "",
    link("/alternatives", "How Heardex compares", "with other listening tools, including where they are the better pick"),
    ...COMPETITORS.map((c) => link(`/alternatives/${c.slug}`, `Heardex vs ${c.name}`, c.summary)),
    "",
    "## Blog",
    "",
    ...[...POSTS].sort((a, b) => b.date.localeCompare(a.date)).map((p) => link(`/blog/${p.slug}`, p.title, p.description)),
    "",
    "## Optional",
    "",
    link("/legal/terms", "Terms of Service"),
    link("/legal/privacy", "Privacy Policy"),
    link("/legal/refunds", "Refund policy", `a first payment can be refunded within ${LEGAL.refundDays} days`),
    link("/legal/contact", "Contact", LEGAL.email),
    "",
  ].join("\n");

  return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
