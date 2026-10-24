"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Check, ChevronsUpDown, Plus, Zap } from "lucide-react";
import { NAV, NAV_GROUPS } from "./nav";
import { GLIDE } from "@/components/motion";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { switchProductAction, switchWorkspaceAction } from "@/app/actions/workspace";
import { cn } from "@/lib/utils";

export interface ShellWorkspace {
  id: string;
  name: string;
  role: string;
}
export interface ShellProductRef { id: string; name: string }
export interface ShellCounts { mentions24h: number; openIssues: number }
export interface ShellPlan { name: string; used: number; allowance: number; upgrade: boolean }

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The Obsidian mark: a signal line on red, with a soft breathing glow. */
export function Mark({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex size-7 shrink-0 items-center justify-center", className)} aria-hidden>
      <span className="breathe absolute inset-0 rounded-full bg-signal blur-md" />
      <svg viewBox="0 0 24 24" className="relative size-7">
        <circle cx="12" cy="12" r="11" fill="var(--signal)" />
        <path d="M6 13.5h3.2l1.6-4.5 2.2 7 1.5-4.2H18" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** Grouped navigation (sidebar and the mobile sheet). The active item gets a gliding red marker. */
export function SidebarNav({ counts, onNavigate }: { counts?: ShellCounts; onNavigate?: () => void }) {
  const pathname = usePathname();
  const badge: Record<string, number | undefined> = { "/mentions": counts?.mentions24h, "/feedback": counts?.openIssues };
  return (
    <nav aria-label="Main" className="grid gap-5">
      {NAV_GROUPS.map((group) => (
        <div key={group} className="grid gap-0.5">
          <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">{group}</p>
          {NAV.filter((n) => n.group === group && n.href !== "/settings").map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            const n = badge[href];
            return (
              <Link key={href} href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}
                className={cn("press relative flex h-9 items-center gap-3 rounded-xl px-3 text-[13px] transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>
                {active && (
                  <motion.span layoutId="nav-active" transition={GLIDE} className="panel absolute inset-0 rounded-xl" aria-hidden>
                    <span className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-full bg-signal shadow-[var(--signal-glow)]" />
                  </motion.span>
                )}
                <Icon className="relative size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="relative flex-1 truncate">{label}</span>
                {n !== undefined && n > 0 && <span className="relative rounded-md bg-foreground/[0.06] px-1.5 text-[11px] tabular-nums text-foreground/80">{n > 999 ? "999+" : n}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Product card: the product everything in the app is about; switches product. */
export function ProductCard({ products, activeId }: { products: ShellProductRef[]; activeId: string | null }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const active = products.find((p) => p.id === activeId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={pending} className="press panel flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left" aria-label="Select product">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-[12px] font-bold text-background">
          {(active?.name ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate text-[13px] font-medium">{active?.name ?? "No product"}</span>
          <span className="text-[11px] text-muted-foreground">Product</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Products</DropdownMenuLabel>
        {products.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => {
            if (p.id === activeId) return;
            const fd = new FormData();
            fd.set("productId", p.id);
            fd.set("returnTo", `/${pathname.split("/")[1] ?? "overview"}`);
            startTransition(() => switchProductAction(fd));
          }}>
            <span className="flex-1 truncate">{p.name}</span>
            {p.id === activeId && <Check aria-hidden />}
          </DropdownMenuItem>
        ))}
        {products.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem asChild><Link href="/onboarding/product"><Plus aria-hidden /> Add product</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceItems({ current, workspaces, pending, start }: {
  current: ShellWorkspace; workspaces: ShellWorkspace[]; pending: boolean; start: (fn: () => void) => void;
}) {
  return (
    <>
      <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
      {workspaces.map((w) => (
        <DropdownMenuItem key={w.id} disabled={pending} onSelect={() => {
          if (w.id === current.id) return;
          const fd = new FormData();
          fd.set("workspaceId", w.id);
          start(() => switchWorkspaceAction(fd));
        }}>
          <span className="flex-1 truncate">{w.name}</span>
          {w.id === current.id && <Check aria-hidden />}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild><Link href="/settings/workspace/new"><Plus aria-hidden /> New workspace</Link></DropdownMenuItem>
    </>
  );
}

export function WorkspaceSwitcher({ current, workspaces }: { current: ShellWorkspace; workspaces: ShellWorkspace[] }) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="press flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-foreground/[0.04]">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-foreground/90 to-foreground/50 text-[11px] font-semibold text-background">
          {current.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate text-[13px] font-medium">{current.name}</span>
          <span className="text-[11px] capitalize text-muted-foreground">{current.role}</span>
        </span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="sr-only">Switch workspace</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <WorkspaceItems current={current} workspaces={workspaces} pending={pending} start={startTransition} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Plan and this period's mention usage; an upgrade nudge only on plans that can upgrade. */
function PlanCard({ plan }: { plan: ShellPlan }) {
  const share = plan.allowance > 0 ? Math.min(1, plan.used / plan.allowance) : 0;
  return (
    <Link href="/settings/billing" className="press panel grid gap-2 rounded-2xl p-3.5 transition-colors">
      <span className="flex items-center justify-between gap-2 text-[13px] font-medium">
        <span className="flex items-center gap-2">{plan.upgrade && <Zap className="size-3.5 text-signal" aria-hidden />}{plan.upgrade ? "Upgrade plan" : `${plan.name} plan`}</span>
        <span className="text-[11px] font-normal tabular-nums text-muted-foreground">{Math.round(share * 100)}%</span>
      </span>
      <span className="block h-1 overflow-hidden rounded-full bg-foreground/[0.08]" aria-hidden>
        <span className="grow-x block h-full rounded-full" style={{ width: `${share * 100}%`, background: share > 0.9 ? "var(--signal)" : "var(--foreground)" }} />
      </span>
      <span className="text-[11px] tabular-nums text-muted-foreground">{plan.used.toLocaleString("en-US")} of {plan.allowance.toLocaleString("en-US")} mentions this period</span>
    </Link>
  );
}

export function Sidebar({ current, workspaces, products, activeProductId, counts, plan }: {
  current: ShellWorkspace; workspaces: ShellWorkspace[]; products: ShellProductRef[]; activeProductId: string | null; counts: ShellCounts; plan: ShellPlan | null;
}) {
  const pathname = usePathname();
  const settings = NAV.find((n) => n.href === "/settings")!;
  const SettingsIcon = settings.icon;
  const onSettings = isActive(pathname, "/settings");
  return (
    <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col gap-5 overflow-y-auto border-r bg-gradient-to-b from-foreground/[0.03] to-transparent px-3 py-5 md:flex print:hidden">
      <Link href="/overview" className="flex items-center gap-2.5 px-2" aria-label="SignalForge home">
        <Mark />
        <span className="text-[16px] font-semibold tracking-[-0.02em]">SignalForge</span>
      </Link>
      <ProductCard products={products} activeId={activeProductId} />
      <SidebarNav counts={counts} />
      <div className="mt-auto grid gap-2">
        {plan && <PlanCard plan={plan} />}
        <Link href="/settings" aria-current={onSettings ? "page" : undefined}
          className={cn("press flex h-9 items-center gap-3 rounded-xl px-3 text-[13px] transition-colors", onSettings ? "panel text-foreground" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>
          <SettingsIcon className="size-4" strokeWidth={1.75} aria-hidden />Settings
        </Link>
        <WorkspaceSwitcher current={current} workspaces={workspaces} />
      </div>
    </aside>
  );
}
