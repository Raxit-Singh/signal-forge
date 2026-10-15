import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { requireWorkspace } from "@/lib/server/session";
import { UpcomingSection } from "../placeholders";

export const metadata: Metadata = { title: "Feedback Intelligence" };

export default async function FeedbackPage() {
  await requireWorkspace();
  return (
    <UpcomingSection
      title="Feedback Intelligence"
      description="Bug reports, feature requests and complaints, grouped into issues with evidence."
      icon={BarChart3}
      emptyTitle="No feedback to analyze yet"
    >
      Once mentions are collected, AI classification groups related reports into issues — each with its supporting
      posts, first and last seen dates, platforms and a confidence level. Reposts are not counted as extra demand.
    </UpcomingSection>
  );
}
