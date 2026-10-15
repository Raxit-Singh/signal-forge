import type { Metadata } from "next";
import { Swords } from "lucide-react";
import { requireWorkspace } from "@/lib/server/session";
import { UpcomingSection } from "../placeholders";

export const metadata: Metadata = { title: "Competitors" };

export default async function CompetitorsPage() {
  await requireWorkspace();
  return (
    <UpcomingSection
      title="Competitors"
      description="Share of voice and sentiment against products you choose, on the same sources."
      icon={Swords}
      emptyTitle="Competitor tracking isn't running yet"
    >
      Comparisons will only use sources monitored for both products, and will say so when coverage differs. Competitor
      slots depend on your plan.
    </UpcomingSection>
  );
}
