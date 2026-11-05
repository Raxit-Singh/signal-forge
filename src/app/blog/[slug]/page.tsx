import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { POSTS, formatPostDate, postBySlug } from "@/content/blog";
import { PageHero } from "@/components/marketing/page-hero";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = postBySlug((await params).slug);
  return p ? { title: { absolute: `${p.title} · Heardex` }, description: p.description, openGraph: { type: "article", publishedTime: p.date, title: p.title, description: p.description } } : {};
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const p = postBySlug((await params).slug);
  if (!p) notFound();
  const more = POSTS.filter((x) => x.slug !== p.slug).slice(0, 2);
  return (
    <article className="hx-frame mx-auto max-w-[1560px] pb-[clamp(96px,14vh,160px)]">
      <div className="mx-auto max-w-[760px]">
        <PageHero sky="threads" size="lg" className="!pb-[clamp(72px,10vh,120px)]"
          eyebrow={<><Link href="/blog" className="hx-link text-[var(--muted)]">Blog</Link> <span className="text-[var(--muted)]">/</span> <Link href={`/blog?category=${p.category.toLowerCase()}`} className="hx-link">{p.category}</Link></>}
          title={p.title} lede={p.description}>
          <p className="text-[14px] text-[var(--muted)]">The Heardex team · <time dateTime={p.date}>{formatPostDate(p.date)}</time> · {p.minutes} min read</p>
        </PageHero>
        <div className="hx-prose hx-rise relative z-10">{p.Body()}</div>
        <div className="mt-14 flex flex-wrap gap-2">
          <Link href="/signup" className="hx-nav is-primary">Start free</Link>
          <Link href="/docs" className="hx-nav is-quiet">Read the docs</Link>
        </div>
      </div>
      {more.length > 0 && (
        <nav aria-label="More posts" className="hx-rise mx-auto mt-20 max-w-[760px] border-t border-[var(--line)] pt-8">
          <h2 className="text-[15px] text-[var(--muted)]">Keep reading</h2>
          <ul className="hx-glow-group mt-4 grid gap-3 sm:grid-cols-2">
            {more.map((m) => (
              <li key={m.slug}><Link href={`/blog/${m.slug}`} className="hx-alt-card hx-glow"><span className="text-[13px] text-[var(--muted)]">{m.category}</span><span className="mt-1 block font-medium leading-snug">{m.title}</span></Link></li>
            ))}
          </ul>
        </nav>
      )}
    </article>
  );
}
