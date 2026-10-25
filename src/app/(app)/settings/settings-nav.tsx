"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Building2, CreditCard, Package, Plug2, Sparkles, Bot, UserRound, type LucideIcon } from "lucide-react";
import { GLIDE } from "@/components/motion";
import { cn } from "@/lib/utils";

const GROUPS: Array<{ label: string; items: Array<{ href: string; label: string; hint: string; icon: LucideIcon }> }> = [
  {
    label: "Workspace",
    items: [
      { href: "/settings/workspace", label: "Workspace", hint: "Name, members, invites", icon: Building2 },
      { href: "/settings/products", label: "Products", hint: "Keywords, links, archive", icon: Package },
      { href: "/settings/connections", label: "Connections", hint: "Google Play reviews", icon: Plug2 },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/settings/ai", label: "SignalForge Intelligence", hint: "AI classification", icon: Sparkles },
      { href: "/settings/agent", label: "Claude", hint: "Connector for your Claude", icon: Bot },
    ],
  },
  {
    label: "You",
    items: [
      { href: "/settings/billing", label: "Plan & billing", hint: "Plan, usage, invoices", icon: CreditCard },
      { href: "/settings/account", label: "Account", hint: "Profile, email, sign-in", icon: UserRound },
    ],
  },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="flex gap-1 overflow-x-auto pb-1 md:grid md:content-start md:gap-5 md:overflow-visible md:pb-0">
      {GROUPS.map((g) => (
        <div key={g.label} className="contents md:grid md:gap-0.5">
          <p className="hidden px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80 md:block">{g.label}</p>
          {g.items.map(({ href, label, hint, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined}
                className={cn("press relative flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 transition-colors md:py-2.5",
                  active ? "text-foreground" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>
                {active && (
                  <motion.span layoutId="settings-active" transition={GLIDE} className="panel absolute inset-0 rounded-xl" aria-hidden>
                    <span className="absolute -left-px top-2.5 bottom-2.5 hidden w-[3px] rounded-r-full bg-signal shadow-[var(--signal-glow)] md:block" />
                  </motion.span>
                )}
                <Icon className="relative size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="relative grid min-w-0">
                  <span className="whitespace-nowrap text-[13px] md:whitespace-normal">{label}</span>
                  <span className="hidden truncate text-[11px] text-muted-foreground/80 md:block">{hint}</span>
                </span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
