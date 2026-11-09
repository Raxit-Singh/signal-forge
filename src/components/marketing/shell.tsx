import Link from "next/link";
import { getUser } from "@/lib/server/session";
import { switzer } from "@/components/landing/fonts";
import { HeardexMark } from "@/components/landing/hero";
import { Outro } from "@/components/landing/outro";
import { MarketingMotion } from "./motion";
import { BarSurface } from "./bar-surface";
import { MobileMenu } from "./mobile-menu";
import { ProductMenu } from "./product-menu";
import { ThemeToggle } from "./theme-toggle";
import "@/components/landing/landing.css";

/** Public pages other than the landing: its look, its top bar and motion, and the red footer. */
export async function MarketingShell({ children }: { children: React.ReactNode }) {
  const start = (await getUser()) ? { href: "/overview", label: "Open dashboard" } : { href: "/signup", label: "Start free" };
  return (
    // --answer is when the landing's opening hands over; here there is no opening, so everything enters at once.
    <div className={`hx hx-site relative min-h-dvh ${switzer.className}`}>
      <MarketingMotion />
      <header className="hx-bar hx-frame fixed inset-x-0 top-0 z-50 flex h-20 items-center justify-between">
        <Link href="/" className="hx-link flex items-center gap-2.5 text-[20px] font-semibold tracking-[-0.03em]" aria-label="Heardex home">
          <HeardexMark animated className="h-6 w-6" />heardex
        </Link>
        <SiteNav start={start} theme />
      </header>
      <main id="main" className="pt-20">{children}</main>
      <Outro start={start} />
    </div>
  );
}

/** The links in the top bar; on phones the secondary ones move into a menu (mobile-menu.tsx). */
export function SiteNav({ start, signIn = false, theme = false }: { start: { href: string; label: string }; signIn?: boolean; theme?: boolean }) {
  return (
    <nav aria-label="Main" className="flex items-center gap-1 text-[15px] font-medium">
      <span className="hx-nav-wide"><ProductMenu /></span>
      <Link href="/docs" className="hx-nav hx-nav-wide">Docs</Link>
      <Link href="/blog" className="hx-nav hx-nav-wide">Blog</Link>
      <Link href="/#pricing" className="hx-nav hx-nav-wide">Pricing</Link>
      {theme && <ThemeToggle />}
      {signIn && <Link href="/login" className="hx-nav hx-nav-wide">Sign in</Link>}
      <Link href={start.href} className="hx-nav is-primary whitespace-nowrap">{start.label}</Link>
      <MobileMenu signIn={start.href === "/signup"} />
      <BarSurface />
    </nav>
  );
}
