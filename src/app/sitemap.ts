import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env";
import { COMPETITORS } from "@/lib/alternatives";
import { LEGAL_PAGES } from "@/lib/legal";
import { PRODUCT_PAGES } from "@/lib/marketing";
import { DOCS } from "@/content/docs";
import { POSTS } from "@/content/blog";

/** Every public page. */
export default function sitemap(): MetadataRoute.Sitemap {
  const site = publicEnv.NEXT_PUBLIC_SITE_URL;
  const page = (path: string, priority: number, lastModified?: string): MetadataRoute.Sitemap[number] =>
    ({ url: `${site}${path}`, priority, ...(lastModified ? { lastModified } : {}) });
  return [
    page("/", 1),
    ...PRODUCT_PAGES.map((p) => page(`/product/${p.slug}`, 0.9)),
    ...DOCS.map((d) => page(d.slug ? `/docs/${d.slug}` : "/docs", 0.7)),
    page("/blog", 0.6),
    ...POSTS.map((p) => page(`/blog/${p.slug}`, 0.6, p.date)),
    page("/alternatives", 0.7),
    ...COMPETITORS.map((c) => page(`/alternatives/${c.slug}`, 0.7)),
    ...LEGAL_PAGES.map((l) => page(l.href, 0.3)),
  ];
}
