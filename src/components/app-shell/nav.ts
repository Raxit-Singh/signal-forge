import {
  BarChart3, FileText, Gauge, LayoutDashboard, Lightbulb, MessageSquareText, Plug, Settings, Swords, Waves,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: "General" | "Insights" | "Other";
}

/** Main navigation, grouped as in the sidebar. Settings is pinned at the bottom of the sidebar. */
export const NAV: readonly NavItem[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard, group: "General" },
  { href: "/mentions", label: "Mentions", icon: MessageSquareText, group: "General" },
  { href: "/feedback", label: "Issues", icon: BarChart3, group: "General" },
  { href: "/buzz", label: "Trends", icon: Waves, group: "Insights" },
  { href: "/competitors", label: "Competitors", icon: Swords, group: "Insights" },
  { href: "/insights", label: "Insights", icon: Lightbulb, group: "Insights" },
  { href: "/monitoring", label: "Monitoring", icon: Gauge, group: "Other" },
  { href: "/integrations", label: "Sources", icon: Plug, group: "Other" },
  { href: "/reports", label: "Reports", icon: FileText, group: "Other" },
  { href: "/settings", label: "Settings", icon: Settings, group: "Other" },
];

export const NAV_GROUPS = ["General", "Insights", "Other"] as const;
