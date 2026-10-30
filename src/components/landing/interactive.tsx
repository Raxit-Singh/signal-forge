"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { PlatformMark } from "@/components/brand-logo";
import { suggestAliases } from "@/lib/domain/aliases";
import { cn } from "@/lib/utils";

/** Adds `is-in` to every .hx-rise / .hx-shutter as it enters, once. Without script everything is simply visible. */
export function Reveal() {
  useEffect(() => {
    document.documentElement.classList.add("hx-js");
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".hx-rise, .hx-shutter").forEach((el) => io.observe(el));
    return () => { io.disconnect(); document.documentElement.classList.remove("hx-js"); };
  }, []);
  return null;
}

const KIND: Record<string, string> = {
  exact_name: "Your name", abbreviation: "Abbreviation", domain: "Website", misspelling: "Variant", handle: "Handle", custom: "Keyword",
};

/**
 * The live thing: type a product name and see the keywords Heardex would really search for
 * (the same suggester onboarding uses) and the platforms each is searched on.
 */
export function KeywordPreview({ platforms }: { platforms: { id: string; name: string }[] }) {
  const id = useId();
  const [name, setName] = useState("Nimbus Notes");
  const terms = useMemo(() => suggestAliases({ name }).slice(0, 6), [name]);
  return (
    <div className="grid gap-5">
      <label htmlFor={id} className="text-[length:var(--step-small)] text-[var(--muted)]">Your product&apos;s name</label>
      <input id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false}
        className="hx-cut h-16 w-full bg-[var(--field-3)] px-5 text-[length:var(--step-lead)] font-semibold text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus-visible:bg-[#2c2c31]"
        placeholder="Type it here" aria-describedby={`${id}-out`} />
      <div id={`${id}-out`} aria-live="polite" className="grid gap-4">
        {terms.length === 0 ? (
          <p className="text-[var(--muted)]">Type a name to see what we would listen for.</p>
        ) : (
          <ul className="grid gap-2" aria-label="Keywords we would search for">
            {terms.map((t) => (
              <li key={t.term} className="flex items-baseline gap-3">
                <span className="hx-bullet translate-y-[-2px]" aria-hidden />
                <span className="min-w-0 truncate font-semibold">{t.term}</span>
                <span className="shrink-0 text-[length:var(--step-small)] text-[var(--muted)]">
                  {KIND[t.kind] ?? "Keyword"}{t.isAmbiguous ? " · only with your context words" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[length:var(--step-small)] text-[var(--muted)]">
          <span className="flex -space-x-1.5" aria-hidden>
            {platforms.slice(0, 7).map((p) => <PlatformMark key={p.id} source={p.id} size={26} className="bg-[var(--field-1)]" />)}
          </span>
          Searched on {platforms.length} platforms, around the clock.
        </p>
      </div>
    </div>
  );
}

export interface FaqItem { tab: string; q: string; a: string }

const FAQ_COLORS = ["#121214", "#18181b", "#1f1f23"];

/** Questions filed like index cards: each tab steps right, one card open at a time. */
export function FaqCards({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState(0);
  const base = useId();
  return (
    <div className="grid">
      {items.map((it, i) => {
        const isOpen = open === i;
        const step = `min(${i * 150}px, calc(100% - 200px))`;
        return (
          <div key={it.tab} className={cn("relative", i > 0 && "-mt-3")} style={{ zIndex: i + 1 }}>
            <button type="button" aria-expanded={isOpen} aria-controls={`${base}-${i}`} id={`${base}-h-${i}`} onClick={() => setOpen(i)}
              className="block w-full text-left focus-visible:outline-2 focus-visible:outline-[var(--red)]">
              <span className="block h-10 w-[200px] px-5 pt-2.5 text-[17px] font-semibold max-md:w-[120px]"
                style={{ marginLeft: step, background: FAQ_COLORS[i % 3], clipPath: "polygon(12px 0, calc(100% - 12px) 0, 100% 100%, 0 100%)" }}>
                {it.tab}
              </span>
              <span className="block px-6 pb-7 pt-5 text-[22px] font-semibold max-md:text-[17px]" style={{ background: FAQ_COLORS[i % 3] }}>{it.q}</span>
            </button>
            <div id={`${base}-${i}`} role="region" aria-labelledby={`${base}-h-${i}`} hidden={!isOpen}
              className="px-6 pb-9 text-[17px] leading-relaxed" style={{ background: FAQ_COLORS[i % 3] }}>
              <p className="max-w-[56ch]">{it.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
