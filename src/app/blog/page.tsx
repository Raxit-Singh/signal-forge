import type { Metadata } from "next";
import Link from "next/link";
import { BLOG_CATEGORIES, POSTS, formatPostDate, type BlogCategory } from "@/content/blog";
import { PageHero } from "@/components/marketing/page-hero";

export const metadata: Metadata = {
  title: { absolute: "Heardex blog: listening to what users say" },
  description: "Guides and notes on finding, sorting and acting on what people say about your software.",
};

export default async function BlogIndex({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const asked = (await searchParams).category;
  const category = BLOG_CATEGORIES.find((c) => c.toLowerCase() === asked?.toLowerCase());
  const posts = [...POSTS].filter((p) => !category || p.category === category).sort((a, b) => b.date.localeCompare(a.date));
  const chip = (c: BlogCategory | null) => (
    <Link key={c ?? "all"} href={c ? `/blog?category=${c.toLowerCase()}` : "/blog"} scroll={false}
      aria-current={(category ?? null) === c ? "page" : undefined} className="hx-chip">{c ?? "All"}</Link>
  );
  return (
    <div className="hx-frame mx-auto max-w-[1560px] pb-[clamp(96px,14vh,160px)]">
      <PageHero eyebrow="Blog" title="Hearing what users say."
        lede="Guides and notes on hearing what people say about your software, and doing something about it.">
        <nav aria-label="Categories" className="flex flex-wrap gap-2">{[chip(null), ...BLOG_CATEGORIES.map(chip)]}</nav>
      </PageHero>
      <ol className="relative z-10 border-t border-[var(--line)]">
        {posts.map((p, i) => (
          <li key={p.slug} className="hx-rise border-b border-[var(--line)]" style={{ ["--d" as string]: `${i * 80}ms` }}>
            <Link href={`/blog/${p.slug}`} className="hx-post-row">
              <span className="text-[14px] text-[var(--muted)]">{p.category} · {formatPostDate(p.date)} · {p.minutes} min read</span>
              <span className="mt-2 block text-[clamp(22px,1.2rem+1vw,32px)] font-semibold leading-tight tracking-[-0.02em]">{p.title}</span>
              <span className="mt-2 block max-w-[70ch] text-[16px] text-[var(--muted)]">{p.description}</span>
            </Link>
          </li>
        ))}
        {!posts.length && <li className="py-10 text-[var(--muted)]">No posts in this category yet.</li>}
      </ol>
    </div>
  );
}
