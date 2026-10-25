import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const STEPS = ["Product", "Keywords", "Platforms", "History"] as const;

/** Numbered progress: done steps get a check, the current one the signal red. */
export function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Onboarding progress">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <li key={label} className={cn("flex items-center gap-2", i < STEPS.length - 1 && "flex-1")} aria-current={current ? "step" : undefined}>
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums transition-colors",
              current ? "bg-signal text-white shadow-[var(--signal-glow)]" : done ? "bg-foreground text-background" : "border text-muted-foreground")}>
              {done ? <Check className="size-3.5" aria-hidden /> : n}
            </span>
            <span className={cn("hidden whitespace-nowrap text-[13px] sm:inline", current ? "font-medium text-foreground" : "text-muted-foreground")}>
              {label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
            {i < STEPS.length - 1 && (
              <span className={cn("h-px min-w-4 flex-1 rounded-full", done ? "bg-foreground/50" : "bg-foreground/[0.1]")} aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** step is 1-based (1 = Product). */
export function StepHeader({ step, title, description }: { step: number; title: string; description: React.ReactNode }) {
  return (
    <div className="rise mb-7 grid gap-8">
      <Stepper step={step} />
      <div className="grid gap-2">
        <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-muted-foreground/80">Step {step} of {STEPS.length}</p>
        <h1 className="text-[32px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[40px]">{title}</h1>
        <div className="max-w-[62ch] text-[14px] text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}
