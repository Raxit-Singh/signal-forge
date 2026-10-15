import type { LucideIcon } from "lucide-react";
import { CoverageNotice, EmptyState, PageHeader } from "@/components/page";

/**
 * Shared layout for sections whose data pipeline ships in a later milestone.
 * Explains what will appear and why it's empty — never shows sample data.
 */
export function UpcomingSection({
  title, description, icon, emptyTitle, children, analytics = true,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  emptyTitle: string;
  children: React.ReactNode;
  analytics?: boolean;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      {analytics && <CoverageNotice />}
      <EmptyState icon={icon} title={emptyTitle} action={{ href: "/integrations", label: "See data sources" }}>
        {children}
      </EmptyState>
    </>
  );
}
