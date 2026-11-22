import Link from "next/link";
import { LEGAL } from "@/lib/legal";
import { SITE_SECTIONS, SOCIAL_LINKS } from "@/lib/marketing";
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
              <Link href={start.href} className="hx-end-cta hx-rise hx-fill">{start.label}</Link>
              {start.href !== "/overview" && <Link href="/login" className="hx-end-signin">Sign in</Link>}
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
          <ul aria-label="Heardex elsewhere" className="flex items-center gap-3">
            {SOCIAL_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} target="_blank" rel="noopener me" aria-label={`Heardex on ${l.label}`} title={l.label}
                  className="-m-2 grid size-10 place-items-center rounded-full transition-opacity hover:opacity-70">
                  <SocialIcon name={l.label} />
                </a>
              </li>
            ))}
          </ul>
          <p>Payments by Dodo Payments, our merchant of record · Prices in US dollars</p>
        </div>
      </div>
    </footer>
  );
}

/** Brand marks for the footer's social links, drawn in the text colour. */
function SocialIcon({ name }: { name: string }) {
  if (name === "Instagram") {
    return (
      <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
        <circle cx="12" cy="12" r="4.25" />
        <circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="size-[19px]" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
