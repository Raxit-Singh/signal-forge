import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocScreen, type DocShot } from "@/components/marketing/doc-screens";

const SHOTS = ["overview", "mentions", "trends", "competitors", "monitoring", "claude", "keywords"];

// The Docs screenshots, drawn from sample data, one per page so scripts/docs-shots.mjs can photograph them.
// Never served in production.
export const metadata: Metadata = { title: "Docs screenshot", robots: { index: false } };

export default async function DocsShot({ params }: { params: Promise<{ shot: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { shot } = await params;
  if (!SHOTS.includes(shot)) notFound();
  return <div style={{ background: "#08080a", width: "max-content" }}><DocScreen shot={shot as DocShot} /></div>;
}
