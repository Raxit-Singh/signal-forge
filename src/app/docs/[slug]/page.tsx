import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DOCS, docBySlug } from "@/content/docs";
import { DocPage } from "../doc-page";

export function generateStaticParams() {
  return DOCS.filter((d) => d.slug).map((d) => ({ slug: d.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const d = docBySlug((await params).slug);
  return d ? { title: { absolute: `${d.title} · Heardex docs` }, description: d.description } : {};
}

export default async function DocsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = slug ? docBySlug(slug) : undefined;
  if (!d) notFound();
  return <DocPage doc={d} />;
}
