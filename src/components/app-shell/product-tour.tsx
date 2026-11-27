"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { completeTourAction } from "@/app/actions/support";

/** Fired (on window) by "Take the tour" in the account menu. */
export const START_TOUR_EVENT = "hx:start-tour";

interface Step { target: string | null; title: string; body: string }

/** One stop per part of the sidebar. `target` is a [data-tour] value; null centres the card. */
const STEPS: readonly Step[] = [
  { target: null, title: "Welcome to Heardex", body: "A quick look at where everything is in the app. It takes under a minute, and you can skip it or replay it from the account menu." },
  { target: "/overview", title: "Overview", body: "Your product at a glance: new mentions, the issues people raise most, and how sentiment is moving." },
  { target: "/mentions", title: "Mentions", body: "Every post and review that names your product, from each platform Heardex checks. Mark one as not relevant and it's left out of your numbers." },
  { target: "/feedback", title: "Issues", body: "Mentions grouped into problems and requests, ranked by how many people raise them. Start here when you're deciding what to fix next." },
  { target: "group:Insights", title: "Trends, Competitors and Insights", body: "How much people talk about you over time, what users say about rivals you add, and how far each issue has got, with summaries and GitHub drafts." },
  { target: "group:Other", title: "Monitoring and Reports", body: "Which platforms are checked and how often, and a weekly report you can print, save as PDF or get by email." },
  { target: "settings", title: "Settings", body: "Keywords and links for each product, your team, Google Play reviews, your plan, and the Heardex connector for Claude and ChatGPT." },
  { target: "report-bug", title: "Report a bug", body: "Something broken or confusing? Tell us here. It reaches us straight away, and we reply by email." },
];

const PAD = 6;
const CARD_W = 320;

function visibleTarget(name: string | null): HTMLElement | null {
  if (!name) return null;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(name)}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** A short guided tour of the app, shown once after onboarding and replayable from the account menu. */
export function ProductTour({ autoStart }: { autoStart: boolean }) {
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const saved = useRef(!autoStart);

  useEffect(() => {
    // Let the first page paint and settle before dimming it.
    if (autoStart) {
      const t = setTimeout(() => setStep(0), 800);
      return () => clearTimeout(t);
    }
  }, [autoStart]);

  useEffect(() => {
    const start = () => setStep(0);
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, []);

  const finish = useCallback(() => {
    setStep(null);
    if (!saved.current) {
      saved.current = true;
      void completeTourAction();
    }
  }, []);

  const current = step === null ? null : STEPS[step]!;

  useLayoutEffect(() => {
    if (!current) return;
    const measure = () => {
      const el = visibleTarget(current.target);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    visibleTarget(current.target)?.scrollIntoView({ block: "nearest" });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [current]);

  useEffect(() => {
    if (step === null) return;
    nextRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") setStep((s) => (s === null ? s : s + 1 < STEPS.length ? s + 1 : s));
      else if (e.key === "ArrowLeft") setStep((s) => (s === null || s === 0 ? s : s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, finish]);

  if (step === null || !current) return null;
  const last = step === STEPS.length - 1;

  // Beside the highlighted item when there's room (the sidebar is on the left); otherwise centred near the bottom.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const beside = rect && rect.right + 16 + CARD_W <= vw;
  const cardStyle: React.CSSProperties = beside
    ? { left: rect.right + 16, top: Math.max(16, Math.min(rect.top + rect.height / 2 - 90, vh - 260)), width: CARD_W }
    : { left: "50%", transform: "translateX(-50%)", bottom: 24, width: `min(${CARD_W + 40}px, calc(100vw - 32px))` };

  return createPortal(
    <div className="fixed inset-0 z-[60]" data-testid="product-tour">
      {rect ? (
        <div aria-hidden className="pointer-events-none fixed rounded-xl transition-all duration-300 ease-out"
          style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: "0 0 0 2px var(--signal), 0 0 24px 2px color-mix(in oklab, var(--signal) 45%, transparent), 0 0 0 9999px rgb(0 0 0 / 0.6)" }} />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/55" />
      )}
      <div role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body"
        className="panel fixed grid gap-3 rounded-2xl bg-surface p-4 shadow-xl transition-[left,top] duration-300 ease-out"
        style={cardStyle}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="tour-title" className="text-[15px] font-semibold tracking-[-0.01em]">{current.title}</h2>
          <button type="button" onClick={finish} aria-label="Skip the tour" className="press -m-1 rounded-md p-1 text-muted-foreground hover:text-foreground">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <p id="tour-body" className="text-[13px] leading-relaxed text-muted-foreground">{current.body}</p>
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-[11px] tabular-nums text-muted-foreground" aria-live="polite">{step + 1} of {STEPS.length}</span>
          <div className="flex gap-2">
            {step > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setStep(step - 1)}>Back</Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={finish}>Skip</Button>
            )}
            <Button ref={nextRef} size="sm" onClick={() => (last ? finish() : setStep(step + 1))}>
              {last ? "Done" : step === 0 ? "Show me" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
