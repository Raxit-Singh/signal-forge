import type { Metadata } from "next";
import { getUser } from "@/lib/server/session";
import { createClient } from "@/lib/supabase/server";
import { planFromRow, type PlanRow } from "@/lib/domain/plans";
import { Landing } from "@/components/landing/landing";
import { INDEXED, SOCIAL_LINKS } from "@/lib/marketing";
import { homeStructuredData, jsonLdScript } from "@/lib/structured-data";
import { publicEnv } from "@/lib/env";

// Search title (about 50 characters, so Google shows it whole) leads with what people search for; the
// description stays under 155 characters.
const TITLE = "Heardex – Product Mention & User Feedback Tracking";
const DESCRIPTION = "Track what people say about your product on Reddit, Hacker News, GitHub and app stores. Heardex sorts every mention into bugs, requests and praise.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  robots: INDEXED,
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: "Heardex", title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", site: "@heardexhq", title: TITLE, description: DESCRIPTION },
};

export default async function Home() {
  const supabase = await createClient();
  // The public plans, as the billing page lists them; if they can't be read the page simply has no pricing.
  const [user, { data: rows }] = await Promise.all([
    getUser(),
    supabase.from("plans").select("*").eq("is_public", true).order("sort_order"),
  ]);
  const plans = (rows ?? []).map((r) => planFromRow(r as PlanRow)).filter((p) => !p.retired);
  const ld = homeStructuredData(publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, ""), {
    plans: plans.filter((p) => p.priceCentsMonthly > 0),
    sameAs: SOCIAL_LINKS.map((l) => l.href),
    description: DESCRIPTION,
  });
  return (
    <>
      {/* For search engines and AI models: what Heardex is and who runs it. A data block, so the CSP doesn't apply. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }} />
      <Landing signedIn={Boolean(user)} plans={plans} />
    </>
  );
}
