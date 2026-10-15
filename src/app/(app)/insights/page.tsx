import type { Metadata } from "next";
import { Lightbulb } from "lucide-react";
import { requireWorkspace } from "@/lib/server/session";
import { UpcomingSection } from "../placeholders";

export const metadata: Metadata = { title: "Product Insights" };

export default async function InsightsPage() {
  await requireWorkspace();
  return (
    <UpcomingSection
      title="Product Insights"
      description="Evidence-based investigations of bugs and feature requests, optionally using your GitHub repository."
      icon={Lightbulb}
      emptyTitle="No investigations yet"
      analytics={false}
    >
      Investigations separate confirmed findings from hypotheses, link every claim to the posts or code it came from,
      and never modify your repository. Creating a GitHub issue always needs your explicit approval.
    </UpcomingSection>
  );
}
