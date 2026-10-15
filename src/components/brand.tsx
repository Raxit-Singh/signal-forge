import { cn } from "@/lib/utils";

/** Wordmark: a small anvil-spark glyph + name. Pure SVG, no external assets. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden>
        <rect x="2" y="2" width="20" height="20" rx="5" className="fill-foreground" />
        <path d="M6 15.5h4l1.5-5 2 7 1.5-4.5H18" className="stroke-primary" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!compact && <span>SignalForge</span>}
    </span>
  );
}
