import { cn } from "@/lib/utils";

// The Heardex mark: six tiles fitted edge to edge (the same drawing as the landing page's
// HeardexMark, without its assembly animation). It takes the text colour, so it follows the theme.

const TILES = [
  "M423 589a186 186 0 0 1 372 0v309a45 45 0 0 1-45 45H468a45 45 0 0 1-45-45z",
  "M863 564h204a45 45 0 0 1 45 45v292a45 45 0 0 1-45 45H863a45 45 0 0 1-45-45V609a45 45 0 0 1 45-45z",
  "M1137 575a371 371 0 0 1 371 371h-371z",
  "M423 985h372v372A372 372 0 0 1 423 985z",
  "M863 985h197a45 45 0 0 1 45 45v292a45 45 0 0 1-45 45H863a45 45 0 0 1-45-45v-292a45 45 0 0 1 45-45z",
  "M1182 989h281a45 45 0 0 1 45 45v309a186 186 0 0 1-372 0v-309a45 45 0 0 1 46-45z",
];

/** The mark alone: about as wide as it is tall. */
export function HeardexMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="423 403 1085 1126" className={cn("h-7 w-7 shrink-0", className)} fill="currentColor" role={title ? "img" : undefined}
      aria-label={title} aria-hidden={title ? undefined : true}>
      {TILES.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/** Mark + wordmark, for headers outside the app shell (sign-in, invitations, OAuth). */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[17px] font-semibold tracking-[-0.03em]", className)}>
      <HeardexMark className="h-6 w-6" />
      <span>heardex</span>
    </span>
  );
}
