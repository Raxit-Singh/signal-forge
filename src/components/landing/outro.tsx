import Link from "next/link";
import { LEGAL, LEGAL_PAGES } from "@/lib/legal";
import { PRODUCT_PAGES, RESOURCE_LINKS } from "@/lib/marketing";
import { HeardexMark } from "./hero";

/**
 * The end of the page: a red block to the bottom. The mark and the name sit on its top edge, red above it on the
 * black page and black below it on the red; under them, everything about the site.
 */
export function Outro({ start }: { start: { href: string; label: string } }) {
  const resources = [...RESOURCE_LINKS, { href: start.href, label: start.label }, { href: "/login", label: "Sign in" }];
  return (
    <footer className="hx-end">
      {/* One gradient for every tile of the mark, split at its middle (the mark's viewBox runs 403 → 1529). */}
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <linearGradient id="hx-end-fill" gradientUnits="userSpaceOnUse" x1="0" y1="403" x2="0" y2="1529">
            <stop offset="0.5" stopColor="var(--red)" />
            <stop offset="0.5" stopColor="var(--ground)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="hx-end-name" aria-hidden>
        <HeardexMark className="hx-end-mark" />
        <span className="hx-end-word">heardex</span>
      </div>

      <div className="hx-frame mx-auto max-w-[1560px] pb-8 pt-[clamp(40px,6vw,88px)]">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))]">
          <div>
            <p className="max-w-[30ch] text-[clamp(22px,1.2rem+0.8vw,30px)] font-semibold leading-tight tracking-[-0.02em]">
              We hear what people say about your product.
            </p>
            <Link href={start.href} className="hx-end-cta mt-6">{start.label}</Link>
          </div>
          <nav aria-label="Product">
            <h2 className="hx-end-head">Product</h2>
            <ul className="hx-end-list">{PRODUCT_PAGES.map((p) => <li key={p.slug}><Link href={`/product/${p.slug}`}>{p.name}</Link></li>)}</ul>
          </nav>
          <nav aria-label="Resources">
            <h2 className="hx-end-head">Resources</h2>
            <ul className="hx-end-list">{resources.map((l) => <li key={l.label}><Link href={l.href}>{l.label}</Link></li>)}</ul>
          </nav>
          <nav aria-label="Policies">
            <h2 className="hx-end-head">Policies</h2>
            <ul className="hx-end-list">
              {LEGAL_PAGES.filter((p) => p.href !== "/legal/contact").map((p) => (
                <li key={p.href}><Link href={p.href}>{p.label === "Terms" ? "Terms of Service" : p.label === "Privacy" ? "Privacy Policy" : "Refund Policy"}</Link></li>
              ))}
            </ul>
          </nav>
          <div>
            <h2 className="hx-end-head">Contact</h2>
            <ul className="hx-end-list">
              <li><a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a></li>
              <li><Link href="/legal/contact">Contact and support</Link></li>
              <li className="hx-end-note">Replies within {LEGAL.replyDays} business days</li>
            </ul>
          </div>
        </div>
        <div className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(5_5_6/0.2)] pt-6 text-[14px] hx-end-note">
          <p>© 2026 {LEGAL.product} · operated by {LEGAL.operator}, {LEGAL.country}</p>
          <p>Payments by Dodo Payments, our merchant of record · Prices in US dollars</p>
        </div>
      </div>
    </footer>
  );
}
