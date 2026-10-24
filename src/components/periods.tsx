"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const PERIODS = [["7d", "Week"], ["30d", "Month"], ["90d", "Quarter"]] as const;

/** Week / Month / Quarter: sets ?range= (7d / 30d / 90d), keeps the other filters, back to page 1. */
export function Periods({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pick = (key: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("range", key);
    for (const k of ["from", "to", "page", "cursor"]) sp.delete(k);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };
  return (
    <div role="radiogroup" aria-label="Period" className="panel flex rounded-full p-1 text-[13px]">
      {PERIODS.map(([k, label]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => pick(k)}
          className={cn("press h-8 rounded-full px-4 transition-colors duration-200",
            value === k ? "bg-foreground/[0.09] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "text-muted-foreground hover:text-foreground")}>
          {label}
        </button>
      ))}
    </div>
  );
}
