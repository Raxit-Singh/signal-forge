"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { ChevronsUpDown, Check, Plus } from "lucide-react";
import { NAV } from "./nav";
import { Logo } from "@/components/brand";
import { GLIDE } from "@/components/motion";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/overlays";
import { switchWorkspaceAction } from "@/app/actions/workspace";
import { cn } from "@/lib/utils";

export interface ShellWorkspace {
  id: string;
  name: string;
  role: string;
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="grid gap-0.5 px-2">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground",
              active && "bg-muted font-medium text-foreground",
            )}
          >
            <Icon className={cn("size-4 shrink-0", active && "text-primary")} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function WorkspaceItems({ current, workspaces, pending, start }: {
  current: ShellWorkspace; workspaces: ShellWorkspace[]; pending: boolean; start: (fn: () => void) => void;
}) {
  return (
    <>
      <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
      {workspaces.map((w) => (
        <DropdownMenuItem
          key={w.id}
          disabled={pending}
          onSelect={() => {
            if (w.id === current.id) return;
            const fd = new FormData();
            fd.set("workspaceId", w.id);
            start(() => switchWorkspaceAction(fd));
          }}
        >
          <span className="flex-1 truncate">{w.name}</span>
          {w.id === current.id && <Check aria-hidden />}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link href="/settings/workspace/new"><Plus aria-hidden /> New workspace</Link>
      </DropdownMenuItem>
    </>
  );
}

export function WorkspaceSwitcher({ current, workspaces }: { current: ShellWorkspace; workspaces: ShellWorkspace[] }) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted">
        <span className="flex size-6 shrink-0 items-center justify-center rounded bg-foreground text-[11px] font-semibold text-background">
          {current.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{current.name}</span>
          <span className="block text-[11px] capitalize text-muted-foreground">{current.role}</span>
        </span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="sr-only">Switch workspace</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <WorkspaceItems current={current} workspaces={workspaces} pending={pending} start={startTransition} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** One rail destination: icon, tooltip with the name, and the gliding active highlight. */
function RailLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: (typeof NAV)[number]["icon"]; active: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          className={cn(
            "press relative flex size-9 items-center justify-center rounded-md transition-colors",
            active ? "text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
          )}
        >
          {active && (
            <motion.span layoutId="rail-active" transition={GLIDE} className="absolute inset-0 rounded-md bg-muted" aria-hidden>
              <span className="absolute -left-[10px] bottom-2 top-2 w-[3px] rounded-r-full bg-primary" />
            </motion.span>
          )}
          <Icon className={cn("relative size-[18px]", active && "text-primary")} strokeWidth={1.75} aria-hidden />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Desktop navigation: a 56px icon rail (names in tooltips), settings and workspace at the bottom. */
export function Rail({ current, workspaces }: { current: ShellWorkspace; workspaces: ShellWorkspace[] }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const main = NAV.filter((n) => n.href !== "/settings");
  const settings = NAV.find((n) => n.href === "/settings")!;
  return (
    <TooltipProvider>
      <aside className="sticky top-0 hidden h-dvh w-14 shrink-0 flex-col items-center border-r bg-surface py-3 lg:flex print:hidden">
        <Link href="/overview" aria-label="SignalForge home" className="press mb-3 flex size-9 items-center justify-center rounded-md hover:bg-muted/70">
          <Logo compact />
        </Link>
        <nav aria-label="Main" className="grid gap-1">
          {main.map((n, i) => (
            <div key={n.href} className={i === 5 ? "mt-2 border-t pt-3" : undefined}>
              <RailLink {...n} active={isActive(pathname, n.href)} />
            </div>
          ))}
        </nav>
        <div className="mt-auto grid gap-1">
          <RailLink {...settings} active={isActive(pathname, settings.href)} />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger className="press mt-1 flex size-9 items-center justify-center rounded-md hover:bg-muted/70" aria-label={`Workspace: ${current.name}. Switch workspace`}>
                  <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-[11px] font-semibold text-background">
                    {current.name.slice(0, 1).toUpperCase()}
                  </span>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">{current.name}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="right" align="end" className="w-60">
              <WorkspaceItems current={current} workspaces={workspaces} pending={pending} start={startTransition} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </TooltipProvider>
  );
}

/** Kept for imports that still use the old name. */
export const Sidebar = Rail;
