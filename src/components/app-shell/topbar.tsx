"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bell, CalendarRange, LogOut, Menu, Search, Settings, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Kbd } from "@/components/ui/primitives";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
  Popover, PopoverContent, PopoverTrigger, Sheet, SheetContent, SheetTrigger,
} from "@/components/ui/overlays";
import { ThemeSwitcher } from "@/components/theme-provider";
import { signOutAction } from "@/app/(auth)/actions";
import { markNotificationsReadAction } from "@/app/actions/notifications";
import { Mark, ProductCard, SidebarNav, WorkspaceSwitcher, type ShellCounts, type ShellWorkspace } from "./sidebar";
import { NAV } from "./nav";
import { CommandMenu, useCommandMenuShortcut } from "./command-menu";
import { LiveIndicator } from "@/components/realtime/realtime-provider";
import { RANGE_PRESETS, parseRange } from "@/lib/domain/date-range";
import { cn } from "@/lib/utils";

export interface ShellProduct { id: string; name: string }
export interface ShellNotification { id: string; title: string; body: string | null; link: string | null; createdAt: string; read: boolean }

// ---------------------------------------------------------------------------
function MobileNav({ current, workspaces, products, activeProductId, counts }: {
  current: ShellWorkspace; workspaces: ShellWorkspace[]; products: ShellProduct[]; activeProductId: string | null; counts: ShellCounts;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation"><Menu /></Button>
      </SheetTrigger>
      <SheetContent title="Navigation" className="gap-4 px-3 py-4">
        <div className="flex items-center gap-2.5 px-2"><Mark /><span className="text-[16px] font-semibold tracking-[-0.02em]">SignalForge</span></div>
        <ProductCard products={products} activeId={activeProductId} />
        <SidebarNav counts={counts} onNavigate={() => setOpen(false)} />
        <div className="mt-auto grid gap-1">
          <Link href="/settings" onClick={() => setOpen(false)} className="flex h-9 items-center gap-3 rounded-xl px-3 text-[13px] text-muted-foreground hover:text-foreground"><Settings className="size-4" aria-hidden />Settings</Link>
          <WorkspaceSwitcher current={current} workspaces={workspaces} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
function DateRangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const range = parseRange(Object.fromEntries(params.entries()), new Date());
  const [from, setFrom] = useState(range.custom ? range.fromDate : "");
  const [to, setTo] = useState(range.custom ? range.toDate : "");

  const apply = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" aria-label={`Date range: ${range.label}`}>
          <CalendarRange className="text-muted-foreground" aria-hidden />
          <span className="hidden sm:inline">{range.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <div role="radiogroup" aria-label="Preset ranges" className="grid grid-cols-4 gap-1">
          {RANGE_PRESETS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={range.key === p.key ? "default" : "secondary"}
              role="radio"
              aria-checked={range.key === p.key}
              onClick={() => apply({ range: p.key, from: null, to: null })}
            >
              {p.short}
            </Button>
          ))}
        </div>
        <form
          className="mt-3 grid gap-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (from && to) apply({ range: "custom", from, to });
          }}
        >
          <p className="text-xs font-medium text-muted-foreground">Custom range</p>
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" aria-label="From" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button type="submit" size="sm" variant="secondary" disabled={!from || !to}>Apply</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
/** Opens the ⌘K command menu (search mentions, jump to a page, switch product). */
function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <>
      <button type="button" onClick={onOpen}
        className="press panel hidden h-9 w-full max-w-[420px] items-center gap-2.5 rounded-full px-3.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground lg:flex">
        <Search className="size-3.5" aria-hidden />
        <span className="flex-1 text-left">Search mentions, issues or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Search or jump to (⌘K)" onClick={onOpen}><Search /></Button>
    </>
  );
}

// ---------------------------------------------------------------------------
function NotificationCenter({ workspaceId, items, unread }: { workspaceId: string; items: ShellNotification[]; unread: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `Notifications (${unread} unread)` : "Notifications"} className="relative">
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-semibold text-primary-foreground tabular">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-[13px] font-semibold">Notifications</span>
          {unread > 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                const fd = new FormData();
                fd.set("workspaceId", workspaceId);
                startTransition(() => markNotificationsReadAction(fd));
              }}
            >
              Mark all read
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
            No notifications yet. Spike alerts and reports will appear here.
          </p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {items.map((n) => (
              <li key={n.id} className={cn("grid gap-0.5 px-3 py-2.5", !n.read && "bg-accent/40")}>
                {n.link ? (
                  <Link href={n.link} className="text-[13px] font-medium hover:underline">{n.title}</Link>
                ) : (
                  <span className="text-[13px] font-medium">{n.title}</span>
                )}
                {n.body && <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                <time className="text-[11px] text-muted-foreground" dateTime={n.createdAt}>
                  {new Date(n.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
function AccountMenu({ email }: { email: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account menu">
          <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">
            {email.slice(0, 1)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="truncate font-normal">{email}</DropdownMenuLabel>
        <div className="flex items-center justify-between px-2 py-1.5 text-[13px]">
          Theme <ThemeSwitcher />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/settings/account"><User aria-hidden /> Account</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/settings"><Settings aria-hidden /> Settings</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { void signOutAction(); }}>
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
export function Topbar(props: {
  email: string;
  current: ShellWorkspace;
  workspaces: ShellWorkspace[];
  products: ShellProduct[];
  activeProductId: string | null;
  counts: ShellCounts;
  notifications: ShellNotification[];
  unread: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useCommandMenuShortcut(setOpen);
  const page = NAV.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));
  const product = props.products.find((p) => p.id === props.activeProductId);
  return (
    <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b bg-background/80 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-md sm:px-6 lg:px-8 print:hidden">
      <MobileNav current={props.current} workspaces={props.workspaces} products={props.products} activeProductId={props.activeProductId} counts={props.counts} />
      <nav aria-label="Breadcrumb" className="flex min-w-0 shrink items-center gap-1.5 text-[13px]">
        {product && <span className="max-w-40 truncate text-muted-foreground">{product.name}</span>}
        {product && page && <span className="text-muted-foreground/50" aria-hidden>/</span>}
        {page && <span className="truncate font-medium" aria-current="page">{page.label}</span>}
      </nav>
      <div className="flex min-w-0 flex-1 justify-center"><SearchTrigger onOpen={() => setOpen(true)} /></div>
      <div className="flex items-center gap-1.5">
        <span className="mr-1 hidden sm:inline-flex"><LiveIndicator /></span>
        <DateRangePicker />
        <NotificationCenter workspaceId={props.current.id} items={props.notifications} unread={props.unread} />
        <AccountMenu email={props.email} />
      </div>
      <CommandMenu open={open} onOpenChange={setOpen} products={props.products} activeProductId={props.activeProductId} />
    </header>
  );
}
