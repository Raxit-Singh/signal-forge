"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { PlatformMark } from "@/components/brand-logo";
import type { SwordRef, SwordState } from "./sword-scene";

const SwordScene = dynamic(() => import("./sword-scene"), { ssr: false });

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

// Sample posts about a made-up notes app, so the story reads at full density; never a customer.
const POSTS = [
  { source: "reddit", where: "r/productivity", who: "u/marta_writes", when: "2h", text: "Export to PDF crashes every time my note is longer than 40 pages.", meta: "214 upvotes" },
  { source: "hackernews", where: "Hacker News", who: "jkl", when: "5h", text: "Search is instant, but the PDF export still falls over on big docs.", meta: "88 points" },
  { source: "app_store", where: "App Store", who: "2 of 5 stars", when: "1d", text: "Lost an hour of work when export froze the app.", meta: "12 found helpful" },
  { source: "github", where: "nimbus/desktop #412", who: "devlin", when: "1d", text: "Sync stalls at 99% after the 1.8 update.", meta: "31 comments" },
  { source: "x", where: "X", who: "@ana_builds", when: "3h", text: "is nimbus sync stuck at 99% for anyone else or just me", meta: "46 likes" },
];

const STAKES = [
  { kind: "Bug", tone: "#ff3b2f", title: "PDF export crashes on long notes", people: 38, line: "Each one is a user one crash from leaving." },
  { kind: "Request", tone: "#2a78d6", title: "Offline mode on mobile", people: 21, line: "The feature they would pay more for." },
  { kind: "Competitor", tone: "#eda100", title: "“Switched to Inkwell for sync”", people: 9, line: "The reason someone just left." },
];

/** Where, in viewport px, the trail's lines meet past the blade's tip once the sword is large (see sword-scene.tsx). */
function meetPx(w: number, h: number) {
  const half = (1584 - 274) / 2 / 300; // the sword's half-length at scale 1
  const halfPx = Math.min((w * (w >= 768 ? 0.78 : 0.94)) / 2, (half * h * 0.5) / 1.93);
  return w / 2 + 1.7 * halfPx;
}

/** A post as the dashboard's mentions feed shows it. */
function PostCard({ p, className = "" }: { p: (typeof POSTS)[number]; className?: string }) {
  return (
    <article className={`hx-panel grid gap-3 p-5 ${className}`}>
      <header className="flex items-center gap-3 text-[13px] text-[var(--muted)]">
        <PlatformMark source={p.source} size={30} />
        <span className="grid min-w-0 leading-tight">
          <span className="truncate font-medium text-[var(--ink)]">{p.where}</span>
          <span className="truncate">{p.who} · {p.when}</span>
        </span>
      </header>
      <p className="text-[17px] leading-snug">{p.text}</p>
      <p className="text-[13px] text-[var(--muted)]">{p.meta}</p>
    </article>
  );
}

/**
 * The opening: one pinned stage. The EX mark starts as the first letters of the wordmark,
 * grows as you scroll while a red light flows in and completes the blade; then the page turns
 * sideways and the story runs along the blade's line: the problem, where it happens, why it
 * matters. When the track ends the page carries on downwards.
 */
export function Story({ platforms, start }: { platforms: { id: string; name: string }[]; start: { href: string; label: string } }) {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLSpanElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const state = useRef<SwordState>({ grow: 0, draw: 0, trail: 0, shiftPx: 0, pointerX: 0, pointerY: 0, anchor: null }) as SwordRef;
  const [gl, setGl] = useState<boolean | null>(null);
  const [visible, setVisible] = useState(true);
  const [still, setStill] = useState(false);

  useEffect(() => {
    state.current!.anchor = slot.current;
    const raf = requestAnimationFrame(() => setGl(hasWebGL()));
    const io = new IntersectionObserver(([e]) => setVisible(e!.isIntersecting));
    if (section.current) io.observe(section.current);
    const onPointer = (e: PointerEvent) => {
      state.current!.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
      state.current!.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    gsap.registerPlugin(ScrollTrigger);
    let mm = gsap.matchMedia();
    // Timeline positions are measured in px of scroll at build time, so it is rebuilt when the width changes.
    const build = () => mm.add({ motion: "(prefers-reduced-motion: no-preference)", reduce: "(prefers-reduced-motion: reduce)" }, (c) => {
      const s = state.current!;
      if (c.conditions!.reduce) {
        // Still version: the mark stays in the wordmark, whole and lit; the story stacks.
        setStill(true);
        Object.assign(s, { grow: 0, draw: 1, trail: 1, shiftPx: 0 });
        return () => setStill(false);
      }
      const el = track.current!;
      const h = window.innerHeight;
      const dist = el.scrollWidth - window.innerWidth;
      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: { trigger: section.current, pin: true, scrub: 0.6, start: "top top", end: `+=${h * 2.1 + dist}` },
        onUpdate: () => {
          s.shiftPx = Number(gsap.getProperty(el, "x")) || 0;
          // The blade's line starts where the trail's lines meet, so the light carries on into the story.
          if (s.shiftPx === 0 && line.current) line.current.style.left = `${Math.min(meetPx(window.innerWidth, h), window.innerWidth) - 2}px`;
        },
      });
      tl.fromTo(s, { grow: 0 }, { grow: 1, duration: h * 1.1 }, 0)
        .fromTo(".hx-hero-words", { opacity: 1, y: 0 }, { opacity: 0, y: -h * 0.06, duration: h * 0.45 }, 0)
        .fromTo(".hx-hero-rest", { opacity: 1, y: 0 }, { opacity: 0, y: h * 0.05, duration: h * 0.3 }, 0)
        .fromTo(s, { trail: 0 }, { trail: 1, duration: h * 0.5 }, h * 0.3)
        .fromTo(s, { draw: 0 }, { draw: 1, duration: h * 1.1, ease: "power1.inOut" }, h * 0.45)
        .fromTo(".hx-hero-claim", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: h * 0.3 }, h * 1.35)
        .fromTo(".hx-line", { scaleX: 0 }, { scaleX: 1, duration: h * 0.25 }, h * 1.5)
        .fromTo(el, { x: 0 }, { x: -dist, duration: dist }, h * 1.85)
        .to({}, { duration: h * 0.25 });
      return () => { Object.assign(s, { grow: 0, draw: 0, trail: 0, shiftPx: 0 }); };
    });
    build();
    let width = window.innerWidth;
    let timer = 0;
    const onResize = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (window.innerWidth === width) return; // a phone's address bar showing or hiding
        width = window.innerWidth;
        mm.revert();
        mm = gsap.matchMedia();
        build();
      }, 200);
    };
    window.addEventListener("resize", onResize);
    // Late layout (fonts, images) moves the end of the pin; measure again once it settles.
    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener("load", refresh);
    document.fonts?.ready.then(refresh);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("load", refresh);
      window.removeEventListener("resize", onResize);
      clearTimeout(timer);
      mm.revert();
    };
  }, [state]);

  return (
    <section ref={section} className={`hx-story relative ${still ? "is-still" : ""}`} aria-label="What Heardex is">
      <div className="hx-stage absolute inset-0" aria-hidden>
        {gl ? (
          <SwordScene state={state} paused={!visible} still={still} />
        ) : gl === false ? (
          <div className="absolute inset-0 bg-[var(--ground)]" />
        ) : null}
      </div>

      <div ref={track} className="hx-track relative flex">
        {/* 1. The name, with the mark as its first letters. */}
        <div className="hx-scene relative flex w-screen shrink-0 flex-col justify-center px-[var(--margin)] pb-[22svh] pt-20 md:pb-[14svh]">
          <p className="hx-hero-rest mb-[clamp(20px,4svh,40px)] flex items-center gap-2.5 text-[13px] uppercase tracking-[0.14em] text-[var(--muted)]">
            <span className="hx-bullet hx-live" aria-hidden />Listening on {platforms.length} platforms
          </p>
          <h1 className="hx-hero-words text-[clamp(42px,8.6vw,156px)] font-medium uppercase leading-[0.92] tracking-[-0.045em]">
            <span className="flex flex-wrap items-end justify-between gap-x-[0.3em]">
              <span ref={slot} className="hx-slot mb-[0.1em] inline-block h-[0.72em] w-[1.224em] shrink-0 max-md:mb-5 max-md:h-[1.3em] max-md:w-[2.21em]" aria-hidden>
                {gl === false && (
                  <svg viewBox="274 740 1310 600" className="h-full w-full" aria-hidden>
                    <path d="M274 1040l78-43h1153l79 43-79 44H352z" fill="#ff3b2f" />
                    <g fill="#f4f4f5"><path d="M554 750h88v580h-88z" /><path d="M554 997h247v87H554z" /><path d="M554 750h411l493 492h82v88h-122L927 838H554z" /><path d="M554 1330h411l493-492h82v-88h-122L927 1242H554z" /></g>
                  </svg>
                )}
              </span>
              <span>Every mention</span>
            </span>
            <span className="flex flex-wrap justify-between gap-x-[0.3em]"><span>of your</span><span>product,</span></span>
            <span className="block">heard <span className="text-[var(--red)]">first.</span></span>
          </h1>
          <div className="hx-hero-rest absolute inset-x-[var(--margin)] bottom-[max(24px,5svh)] grid items-end gap-6 md:grid-cols-[1fr_auto_1fr]">
            <p className="max-w-[360px] text-[15px] leading-relaxed text-[var(--muted)] md:order-3 md:justify-self-end">
              People talk about your product on Reddit, Hacker News, GitHub, the app stores and more. Heardex finds every post and tells you <span className="text-[var(--ink)]">what to fix first.</span>
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 md:order-1">
              <Link href={start.href} className="hx-button">{start.label}</Link>
              <a href="#product" className="hx-link text-[15px] text-[var(--muted)]">See the product →</a>
            </div>
            <a href="#product" className="hx-link hidden flex-col items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-[var(--muted)] md:order-2 md:flex" aria-label="Scroll to the story">
              Scroll
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </a>
          </div>
          <p className="hx-hero-claim pointer-events-none absolute inset-x-[var(--margin)] bottom-[9svh] text-[length:var(--step-lead)] font-medium opacity-0 md:bottom-[12svh]">
            Every mention, heard. Every problem, fixed.
          </p>
        </div>

        {/* The blade's line carries on through the story. */}
        <span ref={line} className="hx-line pointer-events-none absolute left-[96vw] right-0 top-1/2 h-[3px] origin-left -translate-y-1/2" aria-hidden />

        {/* 2. The problem. */}
        <div className="hx-scene grid w-max min-w-[100vw] shrink-0 grid-rows-2 pl-[var(--margin)] pr-[12vw] max-md:w-screen max-md:pr-[var(--margin)]">
          <div className="flex items-end pb-10 md:pl-[8vw]">
            <h2 className="hx-h2 max-w-[13ch]">Right now, someone is posting about you.</h2>
          </div>
          <div className="flex items-start gap-4 pt-10 md:pl-[8vw] max-md:flex-col max-md:gap-3 max-md:pt-6">
            {POSTS.map((p, i) => (
              <PostCard key={p.where} p={p} className={`w-[300px] shrink-0 max-md:w-full ${i % 2 ? "md:mt-8" : ""} ${i > 1 ? "max-md:hidden" : ""}`} />
            ))}
          </div>
        </div>

        {/* 3. Where. */}
        <div className="hx-scene grid w-screen shrink-0 grid-rows-2 px-[var(--margin)]">
          <div className="flex items-end pb-10">
            <h2 className="hx-h2 max-w-[16ch]">Spread across {platforms.length} places you never check.</h2>
          </div>
          <ul className="grid content-start gap-x-8 gap-y-4 pt-10 [grid-template-columns:repeat(auto-fill,minmax(170px,1fr))] max-md:grid-cols-6 max-md:gap-3 max-md:pt-6" aria-label="Platforms Heardex listens on">
            {platforms.map((p) => (
              <li key={p.id} className="flex items-center gap-3 text-[17px]">
                <PlatformMark source={p.id} size={36} />
                <span className="max-md:sr-only">{p.name}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 4. Why it matters. */}
        <div className="hx-scene grid w-[max(100vw,1100px)] shrink-0 grid-rows-2 px-[var(--margin)] max-md:w-screen">
          <div className="flex items-end pb-10">
            <h2 className="hx-h2 max-w-[15ch]">Each one is a bug, a wish or a lost customer.</h2>
          </div>
          <div className="grid grid-cols-3 content-start gap-4 pt-10 max-md:grid-cols-1 max-md:gap-2 max-md:pt-6">
            {STAKES.map((s) => (
              <article key={s.kind} className="hx-panel grid content-start gap-3 p-6 max-md:grid-cols-[1fr_auto] max-md:items-center max-md:gap-x-4 max-md:gap-y-1 max-md:p-4">
                <span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: s.tone }}>
                  <span className="size-2 rounded-full" style={{ background: s.tone }} />{s.kind}
                </span>
                <h3 className="text-[19px] font-semibold leading-snug max-md:col-start-1 max-md:text-[15px]">{s.title}</h3>
                <p className="text-[44px] font-semibold leading-none tracking-[-0.04em] max-md:col-start-2 max-md:row-span-2 max-md:row-start-1 max-md:text-[32px]">{s.people}<span className="ml-2 text-[15px] font-normal tracking-normal text-[var(--muted)] max-md:sr-only">people said it</span></p>
                <p className="text-[15px] text-[var(--muted)] max-md:hidden">{s.line}</p>
              </article>
            ))}
          </div>
        </div>

        {/* 5. The turn: from here the page goes down. */}
        <div className="hx-scene grid w-screen shrink-0 grid-rows-2 px-[var(--margin)]">
          <div className="flex items-end pb-10">
            <h2 className="hx-h2 max-w-[14ch]">Heardex hears all of it, and ranks what to fix.</h2>
          </div>
          <div className="flex items-start pt-10">
            <p className="max-w-[44ch] text-[length:var(--step-lead)] leading-snug text-[var(--muted)]">
              One feed for every platform, AI that sorts bugs from praise, and Claude to help you fix the worst one. Keep scrolling.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
