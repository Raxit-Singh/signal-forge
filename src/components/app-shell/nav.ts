import {
  BarChart3, FileText, LayoutDashboard, Lightbulb, MessageSquareText, Plug, Settings, Swords, Waves,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV: readonly NavItem[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/mentions", label: "Mentions", icon: MessageSquareText },
  { href: "/buzz", label: "Buzz Analytics", icon: Waves },
  { href: "/feedback", label: "Feedback Intelligence", icon: BarChart3 },
  { href: "/competitors", label: "Competitors", icon: Swords },
  { href: "/insights", label: "Product Insights", icon: Lightbulb },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];
