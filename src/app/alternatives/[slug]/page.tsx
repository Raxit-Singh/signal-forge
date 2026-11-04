import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatPrice, intervalPrice, planFromRow, type Plan, type PlanRow } from "@/lib/domain/plans";
import { CHECKED, COMPETITORS, competitor } from "@/lib/alternatives";
import { PageHero } from "@/components/marketing/page-hero";

export function generateStaticParams() {
  return COMPETITORS.map((c) => ({ slug: c.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = competitor((await params).slug);
  if (!c) return {};
  return { title: { absolute: `${c.name} alternative: Heardex vs ${c.name}` }, description: c.summary };
}

const n = (v: number) => v.toLocaleString("en-US");

/** Heardex's side of the table, from the plans table (never typed in here). */
function heardexFacts(plans: Plan[]) {
  const paid = plans.filter((p) => p.priceCentsMonthly > 0).sort((a, b) => a.priceCentsMonthly - b.priceCentsMonthly);
  const free = plans.find((p) => p.priceCentsMonthly === 0);
  const first = paid[0];
  const usd = (c: number) => formatPrice(c, first?.currency ?? "usd");
  return {
    price: paid.map((p) => `${p.name} ${usd(p.priceCentsMonthly)}`).join(", ") + "/month"
      + (first?.priceCentsYearly ? `; ${usd(intervalPrice(first, "year").perMonthCents)}/month and up billed yearly` : ""),
    trial: free ? `Free plan: ${n(free.maxKeywords)} keyword, ${n(free.monthlyMentionLimit)} mentions a month, no card` : "—",
    billing: "Monthly or yearly; cancel any time",
    entry: first ? `${first.name}: ${n(first.maxKeywords)} keyword${first.maxKeywords === 1 ? "" : "s"}, ${n(first.monthlyMentionLimit)} mentions a month` : "—",
    overLimit: "No overage charges: new mentions are held until your allowance renews",
    sources: "Hacker News, GitHub, Stack Overflow, Bluesky, DEV and app store reviews on every plan; Reddit, X, LinkedIn, TikTok, Instagram, Facebook, Substack, news and the web on paid plans",
    extras: "Mentions ranked into bugs, feature requests and complaints (paid plans), competitor tracking (from Pro), daily and weekly reports, Claude MCP connector",
    builtFor: "Software and product teams",
  };
}

const ROWS: Array<[keyof ReturnType<typeof heardexFacts>, string]> = [
  ["price", "Price"],
  ["trial", "Free plan or trial"],
  ["billing", "Billing"],
  ["entry", "First paid plan"],
  ["overLimit", "Past the monthly limit"],
  ["sources", "Where it looks"],
  ["extras", "Notable features"],
  ["builtFor", "Built for"],
];

export default async function AlternativePage({ params }: { params: Promise<{ slug: string }> }) {
  const c = competitor((await params).slug);
  if (!c) notFound();
  const { data } = await (await createClient()).from("plans").select("*").eq("is_public", true).order("sort_order");
  const us = heardexFacts((data ?? []).map((r) => planFromRow(r as PlanRow)).filter((p) => !p.retired));
  const others = COMPETITORS.filter((x) => x.slug !== c.slug);

  return (
    <article className="hx-frame mx-auto max-w-[1560px] pb-[clamp(96px,14vh,160px)]">
      <PageHero eyebrow={<><Link href="/alternatives" className="hx-link text-[var(--muted)]">Alternatives</Link> <span className="text-[var(--muted)]">/</span> {c.name}</>}
        title={`Heardex vs ${c.name}`} lede={c.summary}>
        {c.notice && <p role="note" className="max-w-[70ch] rounded-2xl border border-[rgb(255_59_47/0.45)] bg-[rgb(255_59_47/0.08)] px-5 py-4 text-[15px]">{c.notice}</p>}
      </PageHero>

      <section aria-labelledby="table-title" className="hx-rise relative z-10 -mt-[clamp(32px,6vh,72px)]">
        <h2 id="table-title" className="text-[clamp(28px,3vw,44px)] font-semibold tracking-[-0.03em]">Side by side</h2>
        <div className="hx-alt-table mt-6">
          <table>
            <thead>
              <tr><th scope="col"><span className="sr-only">Compared</span></th><th scope="col" className="is-us">Heardex</th><th scope="col">{c.name}</th></tr>
            </thead>
            <tbody>
              {ROWS.map(([k, label]) => (
                <tr key={k}><th scope="row">{label}</th><td className="is-us">{us[k]}</td><td>{c.facts[k]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[13px] text-[var(--muted)]">
          {c.name} details from {c.source.map((s, i) => <span key={s.href}>{i ? ", " : ""}<a href={s.href} rel="nofollow noopener" target="_blank" className="hx-link underline underline-offset-2">{s.label}</a></span>)}, checked {CHECKED}. Prices
          in US dollars and may have changed since; check their site for the latest.
        </p>
      </section>

      <div className="hx-glow-group mt-16 grid gap-3 lg:grid-cols-2">
        <section className="hx-alt-panel hx-glow hx-rise" aria-labelledby="them-title">
          <h2 id="them-title" className="text-[24px] font-semibold tracking-[-0.02em]">Where {c.name} is stronger</h2>
          <ul className="hx-alt-list mt-5">{c.stronger.map((x) => <li key={x}>{x}</li>)}</ul>
        </section>
        <section className="hx-alt-panel is-us hx-glow hx-rise" style={{ ["--d" as string]: "90ms" }} aria-labelledby="us-title">
          <h2 id="us-title" className="text-[24px] font-semibold tracking-[-0.02em]">Where Heardex is different</h2>
          <ul className="hx-alt-list mt-5">{c.different.map((x) => <li key={x}>{x}</li>)}</ul>
        </section>
      </div>

      <section aria-labelledby="pick-title" className="hx-rise mt-16">
        <h2 id="pick-title" className="text-[clamp(28px,3vw,44px)] font-semibold tracking-[-0.03em]">Which one to pick</h2>
        <dl className="mt-6 grid gap-6 border-t border-[var(--line)] pt-6 sm:grid-cols-2">
          <div><dt className="text-[15px] text-[var(--muted)]">Choose {c.name} if</dt><dd className="mt-2 text-[20px] leading-snug">{c.pickThem}</dd></div>
          <div><dt className="text-[15px] text-[var(--muted)]">Choose Heardex if</dt><dd className="mt-2 text-[20px] leading-snug">{c.pickUs}</dd></div>
        </dl>
        <div className="mt-10 flex flex-wrap gap-2">
          <Link href="/signup" className="hx-nav is-primary">Start free</Link>
          <Link href="/#pricing" className="hx-nav is-quiet">See pricing</Link>
        </div>
      </section>

      <nav aria-label="Other comparisons" className="hx-rise mt-20 border-t border-[var(--line)] pt-8">
        <h2 className="text-[15px] text-[var(--muted)]">More comparisons</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {others.map((o) => <li key={o.slug}><Link href={`/alternatives/${o.slug}`} className="hx-nav is-quiet">vs {o.name}</Link></li>)}
        </ul>
      </nav>

      <p className="mt-12 max-w-[80ch] text-[12px] text-[var(--muted)]">
        {c.name} is a trademark of its owner. Heardex is not affiliated with or endorsed by {c.name}. This comparison is based on
        {" "}{c.name}&apos;s public pages as of {CHECKED}. Spotted something out of date? <Link href="/legal/contact" className="underline underline-offset-2">Tell us</Link> and we&apos;ll fix it.
      </p>
    </article>
  );
}
