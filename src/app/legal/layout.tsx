import Link from "next/link";
import { HeardexMark } from "@/components/landing/hero";
import { LEGAL, LEGAL_PAGES } from "@/lib/legal";
import { LegalNav } from "./legal-nav";

/** Terms, privacy, refunds and contact: public, readable without signing in. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.02em]" aria-label="Heardex home">
            <HeardexMark className="h-5 w-5" />heardex
          </Link>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <LegalNav />
        <main id="main" className="legal pb-20 pt-10">{children}</main>
      </div>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <p>{LEGAL.product} is operated by {LEGAL.operator}, {LEGAL.country}.</p>
          <nav aria-label="Legal" className="flex gap-4">
            {LEGAL_PAGES.map((p) => <Link key={p.href} href={p.href} className="hover:text-foreground">{p.label}</Link>)}
          </nav>
        </div>
      </footer>
    </div>
  );
}
