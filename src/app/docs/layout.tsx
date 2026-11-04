import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/shell";
import { DocsNav } from "@/components/marketing/docs-nav";
import { DOCS, DOC_GROUPS } from "@/content/docs";
import { INDEXED } from "@/lib/marketing";
import { Suspense } from "react";
import { Eclipse } from "@/components/landing/backgrounds";

export const metadata: Metadata = { robots: INDEXED };

const groups = DOC_GROUPS.map((name) => ({
  name,
  pages: DOCS.filter((d) => d.group === name).map((d) => ({ href: d.slug ? `/docs/${d.slug}` : "/docs", title: d.title })),
}));

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <MarketingShell>
      <div className="relative isolate">
        {/* The landing's eclipse, low behind the title of every docs page. */}
        <div aria-hidden className="hx-docs-sky"><Suspense><Eclipse className="h-full w-full" rest={0.97} /></Suspense></div>
        <div className="hx-frame mx-auto grid max-w-[1560px] gap-10 pb-[clamp(96px,14vh,160px)] pt-[clamp(32px,6vh,72px)] lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-16">
          <DocsNav groups={groups} />
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </MarketingShell>
  );
}
