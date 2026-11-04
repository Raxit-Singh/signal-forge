"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { PRODUCT_PAGES } from "@/lib/marketing";

/** The top bar's Product menu: opens on click (and on hover with a mouse), closes on Escape or a click outside. */
export function ProductMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const leave = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const hover = (on: boolean) => (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(leave.current);
    if (on) setOpen(true);
    else leave.current = setTimeout(() => setOpen(false), 150);
  };

  return (
    <div ref={root} className="hx-menu" onPointerEnter={hover(true)} onPointerLeave={hover(false)}>
      <button type="button" className="hx-nav" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        Product
        <svg viewBox="0 0 16 16" aria-hidden className="hx-menu-caret"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      <div id={id} className="hx-menu-panel" data-open={open || undefined}>
        <ul>
          {PRODUCT_PAGES.map((p) => (
            <li key={p.slug}>
              <Link href={`/product/${p.slug}`} onClick={() => setOpen(false)}>
                <span className="block text-[15px] font-medium text-[var(--ink)]">{p.name}</span>
                <span className="block text-[13px] text-[var(--muted)]">{p.line}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
