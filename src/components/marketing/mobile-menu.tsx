"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { SITE_SECTIONS } from "@/lib/marketing";

/** The top bar's menu on phones and small tablets, where the wide links are hidden: a panel that drops from the bar. The footer's categories, each a row that opens to show its links, one open at a time. */
export function MobileMenu({ signIn }: { signIn: boolean }) {
  const id = useId();
  const path = usePathname();
  // Open for the page it was opened on, so it closes on navigation; also on Escape or growing past the breakpoint.
  // The page underneath doesn't scroll while it's open.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;
  const [group, setGroup] = useState<string | null>(null);
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => setOpenOn((typeof v === "function" ? v(open) : v) ? path : null);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenOn(null); };
    const wide = matchMedia("(min-width: 900px)");
    const grow = () => { if (wide.matches) setOpenOn(null); };
    document.addEventListener("keydown", esc);
    wide.addEventListener("change", grow);
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      wide.removeEventListener("change", grow);
      html.style.overflow = before;
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <div className="hx-mnav">
      <button type="button" className="hx-mnav-btn" aria-expanded={open} aria-controls={id}
        aria-label={open ? "Close menu" : "Open menu"} onClick={() => { if (!open) setGroup(null); setOpen(!open); }}>
        <span /><span />
      </button>
      <div id={id} className="hx-mnav-panel" data-open={open || undefined} inert={!open}>
        {SITE_SECTIONS.map((section, i) => {
          const place = { "--i": i } as React.CSSProperties;
          // A group with one link has nothing to open: the row is the link.
          if (section.links.length === 1) {
            return <div key={section.title} className="hx-mnav-item" style={place}><Link href={section.links[0]!.href} onClick={close} className="hx-mnav-row">{section.title}</Link></div>;
          }
          const on = group === section.title;
          const list = `${id}-${i}`;
          return (
            <div key={section.title} className={`hx-mnav-item${on ? " is-open" : ""}`} style={place}>
              <h2>
                <button type="button" className="hx-mnav-row" aria-expanded={on} aria-controls={list} onClick={() => setGroup(on ? null : section.title)}>
                  {section.title}
                  <svg viewBox="0 0 16 16" aria-hidden className="hx-mnav-caret"><path d="m4 6 4 4 4-4" /></svg>
                </button>
              </h2>
              <div id={list} className="hx-mnav-sub" inert={!on}>
                <ul>
                  {section.links.map((l, k) => <li key={l.href} style={{ "--k": k } as React.CSSProperties}><Link href={l.href} onClick={close}>{l.label}</Link></li>)}
                </ul>
              </div>
            </div>
          );
        })}
        {signIn && <div className="hx-mnav-item" style={{ "--i": SITE_SECTIONS.length } as React.CSSProperties}><Link href="/login" onClick={close} className="hx-mnav-row">Sign in</Link></div>}
      </div>
    </div>
  );
}
