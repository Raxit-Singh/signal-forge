import { cn } from "@/lib/utils";

// The Heardex mark: the founder's EX drawn as a sword, standing upright and pointing down
// (E at the top as the hilt, the X below as the blade). Letters take the text colour so the
// mark follows the theme; the blade is the signal red. Geometry is in the original 2000px
// drawing's units, rotated about the artwork's centre.

const LETTERS = [
  "M554 750h88v580h-88z",
  "M554 997h247v87H554z",
  "M554 750h411l493 492h82v88h-122L927 838H554z",
  "M554 1330h411l493-492h82v-88h-122L927 1242H554z",
];
const BLADE = "M274 1040l78-43h1153l79 43-79 44H352z";

/** The mark alone. Size it by height (it is about 0.45× as wide as it is tall). */
export function HeardexMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="629 375 600 1330" className={cn("h-7 w-auto shrink-0", className)} role={title ? "img" : undefined}
      aria-label={title} aria-hidden={title ? undefined : true}>
      <g transform="rotate(90 929 1040)">
        <path d={BLADE} fill="var(--signal)" />
        <g fill="currentColor">{LETTERS.map((d) => <path key={d} d={d} />)}</g>
      </g>
    </svg>
  );
}

/** Mark + wordmark, for headers outside the app shell (sign-in, invitations, OAuth). */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[17px] font-semibold tracking-[-0.03em]", className)}>
      <HeardexMark className="h-7" />
      <span>heardex</span>
    </span>
  );
}
