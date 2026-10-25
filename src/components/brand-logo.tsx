import {
  siAppstore, siBluesky, siDevdotto, siFacebook, siGithub, siGoogle, siGooglenews, siGoogleplay, siInstagram, siReddit,
  siStackoverflow, siSubstack, siTiktok, siTrustpilot, siX, siYcombinator, siYoutube,
} from "simple-icons";
import { cn } from "@/lib/utils";

// Platform marks (Simple Icons, CC0 artwork; the marks remain their owners' trademarks).
// They identify where a mention came from, unaltered, and never imply a partnership.
// LinkedIn isn't in Simple Icons (removed at LinkedIn's request); until its official asset is added,
// it shows a neutral letter rather than a redrawn copy of its mark.

type Mark = { path: string; hex: string; title: string };

const MARKS: Record<string, Mark> = {
  reddit: siReddit, youtube: siYoutube, x: siX, bluesky: siBluesky, hackernews: siYcombinator, github: siGithub,
  stackexchange: siStackoverflow, dev: siDevdotto, app_store: siAppstore, google_play: siGoogleplay, tiktok: siTiktok,
  instagram: siInstagram, facebook: siFacebook, substack: siSubstack, web: siGoogle, news: siGooglenews, trustpilot: siTrustpilot,
};

/** Brands whose colour is (near) black: drawn in the foreground colour so they show on dark too. */
const DARK_BRANDS = new Set(["x", "github", "dev", "tiktok", "google_play"]);

export type LogoVariant = "mono" | "brand" | "badge";

export function hasBrandLogo(source: string) {
  return source in MARKS;
}

/**
 * A platform's logo.
 * - mono: the mark in the current text colour (white in dark mode, black in light).
 * - brand: the mark in the brand's colour (near-black brands follow the text colour).
 * - badge: a white mark on a circle of the brand's colour.
 */
export function BrandLogo({ source, variant = "mono", size = 16, className }: { source: string; variant?: LogoVariant; size?: number; className?: string }) {
  const m = MARKS[source];
  if (!m) {
    return (
      <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full border text-[0.6em] font-semibold uppercase", className)}
        style={{ width: size * (variant === "badge" ? 1.75 : 1.15), height: size * (variant === "badge" ? 1.75 : 1.15), fontSize: size * 0.6 }} aria-hidden>
        {source.slice(0, 1)}
      </span>
    );
  }
  const path = m.path;
  const hex = `#${m.hex}`;
  const brandFill = DARK_BRANDS.has(source) ? "currentColor" : hex;

  if (variant === "badge") {
    const bg = DARK_BRANDS.has(source) ? "var(--foreground)" : hex;
    const fg = DARK_BRANDS.has(source) ? "var(--background)" : "#fff";
    return (
      <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full", className)} style={{ width: size * 1.75, height: size * 1.75, background: bg }} aria-hidden>
        <svg viewBox="0 0 24 24" width={size} height={size} fill={fg}><path d={path} /></svg>
      </span>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={cn("shrink-0", className)} fill={variant === "brand" ? brandFill : "currentColor"} aria-hidden>
      <path d={path} />
    </svg>
  );
}

/** A platform's brand-colour logo on a neutral circle (avatars, platform cards). Red-tinted when `negative`. */
export function PlatformMark({ source, size = 28, negative, className }: { source: string; size?: number; negative?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full border", negative ? "border-signal/40 bg-signal-soft" : "bg-foreground/[0.04]", className)}
      style={{ width: size, height: size }} aria-hidden>
      <BrandLogo source={source} variant="brand" size={Math.round(size * 0.46)} />
    </span>
  );
}
