import Image from "next/image";
import { cn } from "@/lib/utils";
import { Walkthrough, type WalkStep } from "./walkthrough";

/** A part of a screenshot: x/y place it in percent; `at` is where the cursor clicks, if not there. */
export type Spot = WalkStep;

/** Real screenshots of the app (public/docs), taken from a live workspace; the size is the file's own. */
export const SHOTS = {
  overview: { src: "/docs/overview.webp", w: 1440, h: 950, alt: "The Overview page in Heardex: mention total, where the conversation is, platform cards and the mentions chart" },
  mentions: { src: "/docs/mentions.webp", w: 1440, h: 830, alt: "The Mentions page in Heardex: mention total, daily bars, platform cards, filters and the first mention" },
  trends: { src: "/docs/trends.webp", w: 1440, h: 950, alt: "The Trends page in Heardex: mentions, unique authors, period comparisons and mentions over time" },
  competitors: { src: "/docs/competitors.webp", w: 1440, h: 800, alt: "The Competitors page in Heardex with the form to add a competitor" },
  monitoring: { src: "/docs/monitoring.webp", w: 1440, h: 950, alt: "The Monitoring page in Heardex: scan status, keyword performance, where mentions come from and the scan schedule" },
  claude: { src: "/docs/claude.webp", w: 1440, h: 700, alt: "Settings → Claude in Heardex, with the Connect Claude button" },
  keywords: { src: "/docs/keywords.webp", w: 912, h: 410, alt: "A product's keywords in Heardex settings, each with a Needs context switch" },
} as const;

/**
 * A screenshot framed like a window, with numbered markers on the parts the text talks about and a key under it.
 * Markers are placed in percent of the picture, so they stay put at every width.
 */
export function Shot({ shot, spots = [], caption, className, priority }: {
  shot: keyof typeof SHOTS;
  spots?: Spot[];
  caption?: React.ReactNode;
  className?: string;
  priority?: boolean;
}) {
  const s = SHOTS[shot];
  // With steps, the screenshot plays as a walkthrough instead of a still with numbers on it.
  if (spots.length) return <Walkthrough src={s.src} w={s.w} h={s.h} alt={s.alt} steps={spots} priority={priority} />;
  return (
    <figure className={cn("hx-shot hx-rise not-prose", className)}>
      <div className="hx-shot-frame">
        <div className="hx-shot-bar" aria-hidden><span /><span /><span /></div>
        <div className="relative">
          <Image src={s.src} width={s.w} height={s.h} alt={s.alt} sizes="(min-width: 1280px) 900px, 100vw" priority={priority} className="block h-auto w-full" />
          {spots.map((p, i) => (
            <span key={p.label} className="hx-spot" style={{ left: `${p.x}%`, top: `${p.y}%`, ["--d" as string]: `${300 + i * 120}ms` }} aria-hidden>{i + 1}</span>
          ))}
        </div>
      </div>
      {(spots.length > 0 || caption) && (
        <figcaption className="mt-5 grid gap-4">
          {caption && <p className="text-[14px] text-[var(--muted)]">{caption}</p>}
          {spots.length > 0 && (
            <ol className="hx-spot-key">
              {spots.map((p, i) => (
                <li key={p.label}><span aria-hidden>{i + 1}</span><p><strong>{p.label}</strong>{p.text && <> {p.text}</>}</p></li>
              ))}
            </ol>
          )}
        </figcaption>
      )}
    </figure>
  );
}
