"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The docs sidebar; the current page is marked. */
export function DocsNav({ groups }: { groups: Array<{ name: string; pages: Array<{ href: string; title: string }> }> }) {
  const path = usePathname();
  return (
    <nav aria-label="Docs" className="hx-docs-nav">
      {groups.map((g) => (
        <div key={g.name}>
          <h2>{g.name}</h2>
          <ul>
            {g.pages.map((p) => (
              <li key={p.href}><Link href={p.href} aria-current={path === p.href ? "page" : undefined}>{p.title}</Link></li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
