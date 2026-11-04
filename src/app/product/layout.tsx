import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/shell";
import { INDEXED } from "@/lib/marketing";

export const metadata: Metadata = { robots: INDEXED };

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <MarketingShell>{children}</MarketingShell>;
}
