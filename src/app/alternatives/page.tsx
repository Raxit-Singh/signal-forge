import type { Metadata } from "next";
import Link from "next/link";
import { COMPETITORS } from "@/lib/alternatives";
import { PageHero } from "@/components/marketing/page-hero";

export const metadata: Metadata = {
  title: { absolute: "Heardex alternatives and comparisons" },
  description: "How Heardex compares with Octolens, Brand24, Awario, Mention, Sprout Social, Hootsuite, Brandwatch, Meltwater, Google Alerts, Common Room and Trigify.",
};

export default function AlternativesIndex() {
  return (
    <div className="hx-frame mx-auto max-w-[1560px] pb-[clamp(96px,14vh,160px)]">
      <PageHero eyebrow="Alternatives" title="How Heardex compares."
        lede="Heardex listens to what people say about your software and ranks it into bugs, feature requests and complaints. Here's how it stacks up against other listening tools, including where they're the better pick." />
      <ol className="hx-glow-group relative z-10 -mt-[clamp(32px,6vh,72px)] grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {COMPETITORS.map((c, i) => (
          <li key={c.slug} className="hx-rise" style={{ ["--d" as string]: `${(i % 3) * 80}ms` }}>
            <Link href={`/alternatives/${c.slug}`} className="hx-alt-card hx-glow">
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-[22px] font-semibold tracking-[-0.02em]">Heardex vs {c.name}</span>
                <span aria-hidden className="text-[var(--red)]">→</span>
              </span>
              <span className="mt-1 block text-[14px] text-[var(--muted)]">{c.kind}</span>
              <span className="mt-4 block text-[15px] leading-relaxed">{c.summary}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
