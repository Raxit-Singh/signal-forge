import Link from "next/link";
import type { Plan } from "@/lib/domain/plans";
import { switzer } from "./fonts";
import { HeardexMark } from "./hero";
import { HeroBackground } from "./backgrounds";
import { SiteNav } from "@/components/marketing/shell";
import { Faq } from "./faq";
import { IntroLock } from "./intro-lock";
import { Outro } from "./outro";
import { Pricing } from "./pricing";
import { Scenario } from "./scenario";
import { Words } from "./words";
import "./landing.css";



export function Landing({ signedIn, plans }: { signedIn: boolean; plans: Plan[] }) {
  const start = signedIn ? { href: "/overview", label: "Open dashboard" } : { href: "/signup", label: "Start free" };

  return (
    <div className={`hx dark relative [color-scheme:dark] ${switzer.className}`}>
      <IntroLock />
      {/* The bar stays at the top on every screen. Its logo flies off into the story (mention-flight.tsx), and the name
          closes up where it was; at the end of the story the logo flies back (process.tsx). */}
    <header className="hx-bar hx-frame fixed inset-x-0 top-0 z-50 flex h-20 items-center justify-between">
      <Link href="/" className="hx-link flex items-center gap-2.5 text-[20px] font-semibold tracking-[-0.03em]" aria-label="Heardex home">
        <span data-flight-source className="flex"><HeardexMark animated className="h-6 w-6" /></span><span className="hx-word">heardex</span>
      </Link>
      {/* The mark on its way back here from Claude, at the end of the story (process.tsx). */}
      <span data-flight-home className="hx-home" aria-hidden><HeardexMark className="h-full w-full" /></span>
      <SiteNav start={start} signIn={!signedIn} />
    </header>
      {/* The first screen: the question and answer, and the eclipse behind them. */}
      {/* Pinned while the logo comes out of the bar toward you (mention-flight.tsx), then it scrolls away. */}
      <div data-hero-track className="relative h-[200svh]">
      <div className="sticky top-0 flex h-[100svh] min-h-[560px] flex-col overflow-hidden">
        <HeroBackground className="hx-flow pointer-events-none absolute inset-0 h-full w-full" />

        <div className="h-20 flex-none" />
        <section id="main" data-hero-copy className="hx-frame relative z-10 flex flex-1 items-center justify-center pb-20 text-center" aria-label="Heardex">
          {/* The question comes into focus, holds and fades; the answer then comes into focus in the same place. */}
          <h1 className="grid text-[clamp(48px,7.4vw,136px)] font-semibold leading-[0.95] tracking-[-0.05em]">
            <span className="hx-q col-start-1 row-start-1 self-center text-[var(--muted)]" aria-hidden>
              <Words text="What is Heardex?" />
            </span>
            <span className="hx-a col-start-1 row-start-1 self-center">
              <Words text="We hear what people say about your product." breakAfter={4} />
            </span>
          </h1>
        </section>
      </div>
      </div>

      <main>
        <Scenario />
        <Pricing plans={plans} start={start} />
        <Faq plans={plans} />
      </main>
      <Outro start={start} />
    </div>
  );
}
