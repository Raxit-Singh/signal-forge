"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsUpDown, Check, Plus } from "lucide-react";
import { NAV } from "./nav";
import { Logo } from "@/components/brand";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
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
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem
            key={w.id}
            disabled={pending}
            onSelect={() => {
              if (w.id === current.id) return;
              const fd = new FormData();
              fd.set("workspaceId", w.id);
              startTransition(() => switchWorkspaceAction(fd));
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Sidebar({ current, workspaces }: { current: ShellWorkspace; workspaces: ShellWorkspace[] }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-3 border-r bg-surface py-3 lg:flex">
      <div className="px-4 py-1"><Logo /></div>
      <div className="px-2"><WorkspaceSwitcher current={current} workspaces={workspaces} /></div>
      <SidebarNav />
    </aside>
  );
}
