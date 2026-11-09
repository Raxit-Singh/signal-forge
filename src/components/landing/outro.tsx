import Link from "next/link";
import { LEGAL } from "@/lib/legal";
import { SITE_SECTIONS } from "@/lib/marketing";
import { HeardexMark } from "./hero";
import { EndFloat } from "./end-float";

/**
 * The end of the page: a red block to the bottom. The mark and the name sit on its top edge, red above it on the
 * black page and black below it on the red; under them, everything about the site.
 */
export function Outro({ start }: { start: { href: string; label: string } }) {
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
      <EndFloat />

      <div className="hx-frame mx-auto max-w-[1560px] pb-8 pt-[clamp(40px,6vw,88px)]">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))]">
          <div className="col-span-2 lg:col-span-1">
            <p className="max-w-[30ch] text-[clamp(22px,1.2rem+0.8vw,30px)] font-semibold leading-tight tracking-[-0.02em]">
              We hear what people say about your product.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link href={start.href} className="hx-end-cta">{start.label}</Link>
              {start.href === "/signup" && <Link href="/login" className="hx-end-signin">Sign in</Link>}
            </div>
          </div>
          {SITE_SECTIONS.map((section) => (
            <nav key={section.title} aria-label={section.title}>
              <h2 className="hx-end-head">{section.title}</h2>
              <ul className="hx-end-list">
                {section.links.map((l) => <li key={l.href}><Link href={l.href}>{l.label}</Link></li>)}
                {section.title === "Support" && (
                  <>
                    <li className="text-[14px] [overflow-wrap:anywhere] sm:text-[16px]"><a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a></li>
                    <li className="hx-end-note">Replies within {LEGAL.replyDays} business days</li>
                  </>
                )}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(5_5_6/0.2)] pt-6 text-[14px] hx-end-note">
          <p>© 2026 {LEGAL.product} · operated by {LEGAL.operator}, {LEGAL.country}</p>
          <p>Payments by Dodo Payments, our merchant of record · Prices in US dollars</p>
        </div>
      </div>
    </footer>
  );
}
