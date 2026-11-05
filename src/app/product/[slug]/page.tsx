import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { planFromRow, type PlanRow } from "@/lib/domain/plans";
import { PRODUCT, productPage } from "@/content/product";
import { PRODUCT_PAGES } from "@/lib/marketing";
import { PageHero } from "@/components/marketing/page-hero";
import { Shot } from "@/components/marketing/shot";
import { ClaudeClip, FeedClip, SortClip, SpikeClip, VoiceClip } from "@/components/landing/product";
import type { SkyKind } from "@/components/marketing/sky";

const CLIPS = { sort: SortClip, feed: FeedClip, voice: VoiceClip, spike: SpikeClip, claude: ClaudeClip };

export function generateStaticParams() {
  return PRODUCT.map((p) => ({ slug: p.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = productPage((await params).slug);
  return p ? { title: { absolute: `${p.eyebrow} · Heardex` }, description: p.lede } : {};
}

// Each product page has its own background, drawn from what that product does.
const SKIES: Record<string, SkyKind> = {
  "feedback-intelligence": "clusters",
  "smart-monitoring": "pulse",
  "competitor-tracking": "orbits",
  "buzz-analytics": "chart",
  claude: "mcp",
};

export default async function ProductFeaturePage({ params }: { params: Promise<{ slug: string }> }) {
  const p = productPage((await params).slug);
  if (!p) notFound();
  const { data } = await (await createClient()).from("plans").select("*").eq("is_public", true).order("sort_order");
  const plans = (data ?? []).map((r) => planFromRow(r as PlanRow)).filter((x) => !x.retired);
  const others = PRODUCT_PAGES.filter((x) => x.slug !== p.slug);

  const Clip = CLIPS[p.clip];

  return (
    <article className="hx-frame mx-auto max-w-[1560px] pb-[clamp(96px,14vh,160px)]">
      <PageHero sky={SKIES[p.slug] ?? "pulse"} eyebrow={p.eyebrow} title={p.title} lede={p.lede}>
        <div className="flex flex-wrap gap-2">
          <Link href="/signup" className="hx-nav is-primary">Start free</Link>
          <Link href={p.docs.href} className="hx-nav is-quiet">Read the docs</Link>
        </div>
      </PageHero>

      <Shot shot={p.shot} className="is-wide relative z-10 -mt-[clamp(40px,8vh,96px)]" priority caption="Heardex as it is today, in our own workspace that tracks Starlink." />

      <ul className="hx-glow-group mt-[clamp(64px,10vh,120px)] grid gap-3 md:grid-cols-2">
        {p.blocks.map((b, i) => (
          <li key={b.title} className="hx-alt-panel hx-glow hx-rise" style={{ ["--d" as string]: `${(i % 2) * 90}ms` }}>
            <h2 className="text-[22px] font-semibold tracking-[-0.02em]">{b.title}</h2>
            <p className="mt-3 text-[16px] leading-relaxed text-[var(--muted)]">{b.body}</p>
          </li>
        ))}
      </ul>

      <section aria-labelledby="how-title" className="mt-24 grid items-start gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
        <div className="hx-rise">
          <h2 id="how-title" className="hx-h2">How it works</h2>
          <ol className="hx-steps mt-10">
            {p.steps.map((s, i) => <li key={s}><span aria-hidden>{String(i + 1).padStart(2, "0")}</span>{s}</li>)}
          </ol>
        </div>
        <figure className="hx-rise" style={{ ["--d" as string]: "120ms" }}>
          <div className="hx-island dark"><Clip /></div>
          <figcaption className="mt-4 text-[13px] text-[var(--muted)]">An animated example with sample data about a made-up notes app.</figcaption>
        </figure>
      </section>

      <section aria-labelledby="plans-title" className="hx-rise mt-24 grid gap-10 border-t border-[var(--line)] pt-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
        <h2 id="plans-title" className="text-[clamp(28px,3vw,44px)] font-semibold tracking-[-0.03em]">On which plans</h2>
        <div>
          <ul className="hx-alt-list text-[17px]">{p.plans(plans).map((x) => <li key={x}>{x}</li>)}</ul>
          <h3 className="mt-10 text-[15px] text-[var(--muted)]">Good to know</h3>
          <ul className="hx-alt-list mt-3 text-[var(--muted)]">{p.limits.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="mt-8"><Link href={p.docs.href} className="hx-faq-link">{p.docs.label} →</Link></p>
        </div>
      </section>

      <nav aria-label="More of the product" className="mt-24 border-t border-[var(--line)] pt-8">
        <h2 className="text-[15px] text-[var(--muted)]">More of Heardex</h2>
        <ul className="hx-glow-group mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {others.map((o, i) => (
            <li key={o.slug} className="hx-rise" style={{ ["--d" as string]: `${i * 70}ms` }}>
              <Link href={`/product/${o.slug}`} className="hx-alt-card hx-glow">
                <span className="block text-[18px] font-semibold tracking-[-0.01em]">{o.name}</span>
                <span className="mt-2 block text-[14px] text-[var(--muted)]">{o.line}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </article>
  );
}
