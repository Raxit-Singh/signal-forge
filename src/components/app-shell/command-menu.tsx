"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Box, Check, CornerDownLeft, Plus, Search } from "lucide-react";
import { NAV } from "./nav";
import { switchProductAction } from "@/app/actions/workspace";
import type { ShellProduct } from "./topbar";

const itemCls = "flex h-9 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground outline-none data-[selected=true]:bg-muted [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";
const groupCls = "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";

/** Opens the command menu from anywhere (⌘K / Ctrl+K, or "/" when not typing). */
export function useCommandMenuShortcut(setOpen: (fn: (o: boolean) => boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(() => true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
}

/**
 * ⌘K: go to any page, switch product, search mentions. Keyboard-first, so it opens and
 * closes without movement (100+ times a day); only a quick fade.
 */
export function CommandMenu({ open, onOpenChange, products, activeProductId }: {
  open: boolean; onOpenChange: (o: boolean) => void; products: ShellProduct[]; activeProductId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [, startTransition] = useTransition();
  const run = (fn: () => void) => { onOpenChange(false); setQuery(""); fn(); };
  const q = query.trim();

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) setQuery(""); }}
      label="Command menu"
      overlayClassName="cmdk-overlay fixed inset-0 z-50 bg-black/50"
      contentClassName="cmdk-panel fixed left-1/2 top-[14vh] z-50 w-[min(560px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-xl border bg-surface shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b px-3.5">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Command.Input value={query} onValueChange={setQuery} placeholder="Search mentions or jump to…"
          className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground" />
        <kbd className="rounded border px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground">Esc</kbd>
      </div>
      <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted-foreground">Nothing matches.</Command.Empty>
        {q && (
          <Command.Group heading="Search" className={groupCls}>
            <Command.Item value={`search ${q}`} className={itemCls} onSelect={() => run(() => router.push(`/mentions?q=${encodeURIComponent(q)}`))}>
              <Search aria-hidden /><span className="flex-1 truncate">Search mentions for “{q}”</span><CornerDownLeft aria-hidden />
            </Command.Item>
          </Command.Group>
        )}
        <Command.Group heading="Go to" className={groupCls}>
          {NAV.map(({ href, label, icon: Icon }) => (
            <Command.Item key={href} value={`go ${label}`} className={itemCls} onSelect={() => run(() => router.push(href))}>
              <Icon aria-hidden /><span className="flex-1">{label}</span>
              {(pathname === href || pathname.startsWith(`${href}/`)) && <span className="text-[11px] text-muted-foreground">Current</span>}
            </Command.Item>
          ))}
        </Command.Group>
        {products.length > 0 && (
          <Command.Group heading="Products" className={groupCls}>
            {products.map((p) => (
              <Command.Item key={p.id} value={`product ${p.name}`} className={itemCls} onSelect={() => run(() => {
                if (p.id === activeProductId) return;
                const fd = new FormData();
                fd.set("productId", p.id);
                fd.set("returnTo", `/${pathname.split("/")[1] ?? "overview"}`);
                startTransition(() => switchProductAction(fd));
              })}>
                <Box aria-hidden /><span className="flex-1 truncate">{p.name}</span>{p.id === activeProductId && <Check aria-hidden />}
              </Command.Item>
            ))}
            <Command.Item value="add product" className={itemCls} onSelect={() => run(() => router.push("/onboarding/product"))}>
              <Plus aria-hidden /><span>Add product</span>
            </Command.Item>
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
