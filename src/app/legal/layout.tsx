import type { Metadata } from "next";
import { INDEXED } from "@/lib/marketing";
import { Suspense } from "react";
import { MarketingShell } from "@/components/marketing/shell";
import { Eclipse } from "@/components/landing/backgrounds";
import { LegalNav } from "./legal-nav";

export const metadata: Metadata = { robots: INDEXED };

/** Terms, privacy, refunds and contact: public, readable without signing in, in the same frame as the rest of the site. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <MarketingShell>
      <div className="relative isolate">
      <div aria-hidden className="hx-docs-sky"><Suspense><Eclipse className="h-full w-full" rest={0.99} /></Suspense></div>
      <div className="hx-frame mx-auto max-w-[1560px] pb-[clamp(96px,14vh,160px)]">
        <div className="mx-auto max-w-[760px]">
          <LegalNav />
          <div className="legal pt-[clamp(40px,8vh,96px)]">{children}</div>
        </div>
      </div>
      </div>
    </MarketingShell>
  );
}
