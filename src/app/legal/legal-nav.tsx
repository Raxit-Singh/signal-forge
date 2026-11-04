"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LEGAL_PAGES } from "@/lib/legal";

export function LegalNav() {
  const path = usePathname();
  return (
    <nav aria-label="Policies" className="-mx-1 flex gap-1 overflow-x-auto pt-6 text-sm">
      {LEGAL_PAGES.map((p) => (
        <Link
          key={p.href}
          href={p.href}
          aria-current={path === p.href ? "page" : undefined}
          className="whitespace-nowrap rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
