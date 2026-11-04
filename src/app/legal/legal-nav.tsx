"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LEGAL_PAGES } from "@/lib/legal";

export function LegalNav() {
  const path = usePathname();
  return (
    <nav aria-label="Policies" className="hx-in flex gap-2 overflow-x-auto pt-[clamp(32px,6vh,64px)]">
      {LEGAL_PAGES.map((p) => (
        <Link
          key={p.href}
          href={p.href}
          aria-current={path === p.href ? "page" : undefined}
          className="hx-chip whitespace-nowrap"
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
