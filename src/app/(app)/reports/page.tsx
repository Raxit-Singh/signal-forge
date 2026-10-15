import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { requireWorkspace } from "@/lib/server/session";
import { UpcomingSection } from "../placeholders";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  await requireWorkspace();
  return (
    <UpcomingSection
      title="Reports"
      description="Weekly product-intelligence reports, downloadable and emailed."
      icon={FileText}
      emptyTitle="No reports yet"
    >
      The first weekly report is generated after a full week of monitoring. Every number in it is computed from the
      same stored data as the dashboards, so they always match.
    </UpcomingSection>
  );
}
