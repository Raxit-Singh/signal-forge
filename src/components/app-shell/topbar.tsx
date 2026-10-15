"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bell, Box, CalendarRange, Check, ChevronDown, LogOut, Menu, Plus, Search, Settings, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Kbd } from "@/components/ui/primitives";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
  Popover, PopoverContent, PopoverTrigger, Sheet, SheetContent, SheetTrigger,
} from "@/components/ui/overlays";
import { ThemeSwitcher } from "@/components/theme-provider";
import { Logo } from "@/components/brand";
import { switchProductAction } from "@/app/actions/workspace";
import { signOutAction } from "@/app/(auth)/actions";
import { markNotificationsReadAction } from "@/app/actions/notifications";
import { SidebarNav, WorkspaceSwitcher, type ShellWorkspace } from "./sidebar";
import { RANGE_PRESETS, parseRange } from "@/lib/domain/date-range";
import { cn } from "@/lib/utils";

export interface ShellProduct { id: string; name: string }
export interface ShellNotification { id: string; title: string; body: string | null; link: string | null; createdAt: string; read: boolean }

// ---------------------------------------------------------------------------
function MobileNav({ current, workspaces }: { current: ShellWorkspace; workspaces: ShellWorkspace[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation"><Menu /></Button>
      </SheetTrigger>
      <SheetContent title="Navigation" className="gap-3 py-3">
        <div className="px-4 py-1"><Logo /></div>
        <div className="px-2"><WorkspaceSwitcher current={current} workspaces={workspaces} /></div>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
function ProductSwitcher({ products, activeId }: { products: ShellProduct[]; activeId: string | null }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const active = products.find((p) => p.id === activeId);
  const section = `/${pathname.split("/")[1] ?? "overview"}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className="max-w-52" disabled={pending} aria-label="Select product">
          <Box className="text-muted-foreground" aria-hidden />
          <span className="truncate">{active?.name ?? "No product"}</span>
          <ChevronDown className="text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Products</DropdownMenuLabel>
        {products.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() => {
              if (p.id === activeId) return;
              const fd = new FormData();
              fd.set("productId", p.id);
              fd.set("returnTo", section);
              startTransition(() => switchProductAction(fd));
            }}
          >
            <span className="flex-1 truncate">{p.name}</span>
            {p.id === activeId && <Check aria-hidden />}
          </DropdownMenuItem>
        ))}
        {products.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem asChild>
          <Link href="/onboarding/product"><Plus aria-hidden /> Add product</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
          <p className="text-xs font-medium text-muted-foreground">Custom range (UTC days)</p>
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
function GlobalSearch() {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      className="relative hidden max-w-xs flex-1 md:block"
      onSubmit={(e) => {
        e.preventDefault();
        const q = ref.current?.value.trim() ?? "";
        router.push(q ? `/mentions?q=${encodeURIComponent(q)}` : "/mentions");
      }}
    >
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input ref={ref} name="q" type="search" placeholder="Search mentions" aria-label="Search mentions" maxLength={200} className="pl-8 pr-8" />
      <Kbd className="absolute right-2 top-1/2 -translate-y-1/2">/</Kbd>
    </form>
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
  notifications: ShellNotification[];
  unread: number;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur sm:px-4">
      <MobileNav current={props.current} workspaces={props.workspaces} />
      <ProductSwitcher products={props.products} activeId={props.activeProductId} />
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-1">
        <DateRangePicker />
        <NotificationCenter workspaceId={props.current.id} items={props.notifications} unread={props.unread} />
        <AccountMenu email={props.email} />
      </div>
    </header>
  );
}
