"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface WalkStep { x: number; y: number; at?: [number, number]; label: string; text?: string }

const STEP_MS = 3400;
const REST_MS = 1800;
const ZOOM = 1.75;

/**
 * A screenshot of the app played like a short screen recording: a cursor moves to each part in turn, clicks it, the view
 * closes in on it and the caption says what it is; then it pulls back out and starts again. It plays only while in view,
 * and never on its own with reduced motion (the step buttons still work). The picture itself is the real app.
 */
export function Walkthrough({ src, w, h, alt, steps, priority }: { src: string; w: number; h: number; alt: string; steps: WalkStep[]; priority?: boolean }) {
  const root = useRef<HTMLElement>(null);
  const [i, setI] = useState(-1); // -1: the whole screen, before the first step
  const [playing, setPlaying] = useState(true);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setSeen(!!e?.isIntersecting), { threshold: 0.45 });
    if (root.current) io.observe(root.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !seen) return;
    // With reduced motion it never moves on by itself; the step buttons still work.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setTimeout(() => setI((x) => (x + 1 >= steps.length ? -1 : x + 1)), i < 0 ? REST_MS : STEP_MS);
    return () => clearTimeout(id);
  }, [i, playing, seen, steps.length]);

  const cur = i >= 0 ? steps[i] : undefined;
  const [cx, cy] = cur ? (cur.at ?? [cur.x, cur.y]) : [58, 62];
  const zoom = cur ? ZOOM : 1;

  return (
    <figure ref={root} className="hx-walk hx-shot hx-rise">
      <div className="hx-shot-frame">
        <div className="hx-shot-bar">
          <span aria-hidden /><span aria-hidden /><span aria-hidden />
          <span className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted)]">
            {playing && seen && <span className="hx-live size-1.5 rounded-full bg-[var(--red)]" aria-hidden />}
            {cur ? `${i + 1} / ${steps.length}` : "Walkthrough"}
          </span>
        </div>
        <div className="relative overflow-hidden">
          <div className="hx-walk-cam" style={{ transform: `scale(${zoom})`, transformOrigin: `${cx}% ${cy}%` }}>
            <Image src={src} width={w} height={h} alt={alt} sizes="(min-width: 1280px) 900px, 100vw" priority={priority} className="block h-auto w-full" />
            {cur && <span key={`r${i}`} className="hx-walk-ring" style={{ left: `${cx}%`, top: `${cy}%` }} aria-hidden />}
            <span className="hx-walk-cursor" style={{ left: `${cx}%`, top: `${cy}%`, ["--z" as string]: 1 / zoom }} aria-hidden>
              <svg viewBox="0 0 24 24"><path d="M5 3l14 8.2-6.1 1.3 3.6 6.6-2.7 1.5-3.6-6.6L5.8 18z" /></svg>
            </span>
          </div>
        </div>
        {/* Chapters, like a video's: one per step, the current one filling up. */}
        <div className="hx-walk-bar">
          <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause walkthrough" : "Play walkthrough"} className="hx-walk-play">
            {playing ? <svg viewBox="0 0 16 16" aria-hidden><path d="M5 3h2v10H5zM9 3h2v10H9z" /></svg> : <svg viewBox="0 0 16 16" aria-hidden><path d="M5 3l8 5-8 5z" /></svg>}
          </button>
          <ol className="flex flex-1 gap-1.5" aria-label="Steps">
            {steps.map((s, k) => (
              <li key={s.label} className="flex-1">
                <button type="button" onClick={() => setI(k)} aria-label={`Step ${k + 1}: ${s.label}`} aria-current={k === i ? "step" : undefined} className="hx-walk-seg">
                  <span key={k === i ? `on${i}` : "off"} className={cn(k < i && "is-done", k === i && (playing && seen ? "is-on" : "is-done"))} style={{ animationDuration: `${STEP_MS}ms` }} />
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <figcaption className="hx-walk-cap" aria-live="polite">
        {cur ? (
          <p key={i}><span aria-hidden>{i + 1}</span><span><strong>{cur.label}</strong>{cur.text && <> {cur.text}</>}</span></p>
        ) : (
          <p className="text-[var(--muted)]">{steps.length} steps · {playing ? "playing" : "press play or pick a step"}</p>
        )}
      </figcaption>
      <ol className="sr-only">{steps.map((s) => <li key={s.label}>{s.label} {s.text}</li>)}</ol>
    </figure>
  );
}
