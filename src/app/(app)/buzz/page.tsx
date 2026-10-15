import type { Metadata } from "next";
import { Waves } from "lucide-react";
import { requireWorkspace } from "@/lib/server/session";
import { UpcomingSection } from "../placeholders";

export const metadata: Metadata = { title: "Buzz Analytics" };

export default async function BuzzPage() {
  await requireWorkspace();
  return (
    <UpcomingSection
      title="Buzz Analytics"
      description="How much attention your product gets, where, and whether it's rising."
      icon={Waves}
      emptyTitle="No attention data yet"
    >
      Daily mentions, growth versus the previous period, source mix, sentiment and an experimental, explainable virality
      score will be computed only from mentions SignalForge actually collected. Periods with no monitoring are marked
      as gaps, not zeros.
    </UpcomingSection>
  );
}
