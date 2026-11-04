import { Suspense } from "react";
import { Eclipse } from "@/components/landing/backgrounds";
import { Words } from "@/components/landing/words";
import { cn } from "@/lib/utils";

/**
 * The top of every public page, in the landing's manner: the title comes out of a blur word by word, the line under it
 * and the actions rise in after it, and (with `eclipse`) the landing's planet rises behind them.
 */
export function PageHero({ eyebrow, title, lede, children, eclipse = true, size = "xl", className }: {
  eyebrow?: React.ReactNode;
  title: string;
  lede?: React.ReactNode;
  children?: React.ReactNode;
  eclipse?: boolean;
  size?: "xl" | "lg";
  className?: string;
}) {
  return (
    <header className={cn("hx-hero relative isolate", eclipse && "is-eclipse", className)}>
      {eclipse && (
        <div aria-hidden className="hx-hero-sky">
          <Suspense><Eclipse className="h-full w-full" /></Suspense>
        </div>
      )}
      {eyebrow && <p className="hx-in text-[15px] font-medium text-[var(--red)]" style={{ ["--d" as string]: "80ms" }}>{eyebrow}</p>}
      <h1 className={cn("hx-title mt-4 font-semibold tracking-[-0.05em]", size === "xl" ? "max-w-[20ch] text-[clamp(40px,6vw,104px)] leading-[0.95]" : "text-[clamp(34px,4.6vw,68px)] leading-[1]")}>
        <Words text={title} from="start" />
      </h1>
      {lede && <p className="hx-in mt-6 max-w-[60ch] text-[length:var(--step-lead)] leading-snug text-[var(--muted)]" style={{ ["--d" as string]: "520ms" }}>{lede}</p>}
      {children && <div className="hx-in mt-10" style={{ ["--d" as string]: "700ms" }}>{children}</div>}
    </header>
  );
}
