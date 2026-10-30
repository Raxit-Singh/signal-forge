import Link from "next/link";
import localFont from "next/font/local";
import { HeardexMark } from "./hero";
import { HeroBackground } from "./backgrounds";
import { IntroLock } from "./intro-lock";
import { Scenario } from "./scenario";
import { Words } from "./words";
import "./landing.css";

const switzer = localFont({
  src: [
    { path: "./fonts/Switzer-400.woff2", weight: "400" },
    { path: "./fonts/Switzer-500.woff2", weight: "500" },
    { path: "./fonts/Switzer-600.woff2", weight: "600" },
  ],
  display: "swap",
});

export function Landing({ signedIn }: { signedIn: boolean }) {
  const start = signedIn ? { href: "/overview", label: "Open dashboard" } : { href: "/signup", label: "Start free" };

  return (
    <div className={`hx dark relative [color-scheme:dark] ${switzer.className}`}>
      <IntroLock />
      {/* The first screen: the bar, the question and answer, and the eclipse behind them. */}
      {/* Pinned while the logo comes out of the bar toward you (mention-flight.tsx), then it scrolls away. */}
      <div data-hero-track className="relative h-[200svh]">
      <div className="sticky top-0 flex h-[100svh] min-h-[560px] flex-col overflow-hidden">
        <HeroBackground className="hx-flow pointer-events-none absolute inset-0 h-full w-full" />
        <header className="hx-bar hx-frame relative z-10 flex h-20 items-center justify-between">
          <Link href="/" className="hx-link flex items-center gap-2.5 text-[20px] font-semibold tracking-[-0.03em]" aria-label="Heardex home">
            <span data-flight-source className="flex"><HeardexMark animated className="h-6 w-6" /></span>heardex
          </Link>
          <nav aria-label="Main" className="flex items-center gap-2 text-[15px] font-medium">
            {!signedIn && <Link href="/login" className="hx-nav">Sign in</Link>}
            <Link href={start.href} className="hx-nav is-primary">{start.label}</Link>
          </nav>
        </header>

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
      </main>
    </div>
  );
}
