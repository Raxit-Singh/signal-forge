"use client";

import { useEffect, useRef } from "react";
import { Dive } from "./dive";
import { MentionFlight } from "./mention-flight";
import { Process } from "./process";
import { Words } from "./words";

/**
 * The second screen: the situation, then what Heardex does about it. Both lines come into focus word by word,
 * left to right, the first time the screen is in view. Without script, or with reduced motion, the words simply show.
 */
export function Scenario() {
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = section.current!;
    el.classList.add("is-armed");
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      el.classList.add("is-in");
      io.disconnect();
    }, { threshold: 0.45 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    // A tall track: the section pins to the top while the logo comes down into the tray, the story plays, and the scene
    // turns to face you, and the wires grow out to every platform (mention-flight.tsx).
    <div data-flight-track className="relative h-[1560svh]">
    <section ref={section} className="hx-s hx-frame sticky top-0 grid min-h-[100svh] content-center items-center gap-14 py-24 text-left lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-10" aria-labelledby="scenario">
      <div data-scenario-copy className="grid max-w-[21ch] gap-[0.5em] text-[clamp(28px,3.4vw,56px)] font-semibold leading-[1.05] tracking-[-0.035em]">
        <p className="hx-s1 text-[var(--muted)]"><Words text="Say someone mentions your app on Reddit." from="start" /></p>
        <h2 id="scenario" className="hx-s2"><Words text="We hear it, and bring it straight to you." from="start" /></h2>
      </div>
      <div className="mx-auto w-full max-w-[680px] lg:mr-0">
        <MentionFlight />
      </div>
      {/* Over the network, once its wires have reached every platform (mention-flight.tsx fades it in). */}
      <div data-network-title className="pointer-events-none absolute inset-x-0 top-0 z-10 px-[var(--margin)] pt-24 text-center opacity-0" aria-hidden>
        <p className="text-[clamp(24px,3.4vw,52px)] font-semibold leading-[1.05] tracking-[-0.035em]">Every mention, from 18 platforms.</p>
        <p className="mt-2 hidden text-[15px] text-[var(--muted)] sm:block">Reddit, X, YouTube, Hacker News, GitHub, Stack Overflow, the App Store, Google Play, Trustpilot, the news and more, in one feed.</p>
        <p className="mt-2 text-[14px] text-[var(--muted)] sm:hidden">Social, code, app stores, reviews and the news, in one feed.</p>
      </div>
      <Dive />
      <Process />
    </section>
    </div>
  );
}
