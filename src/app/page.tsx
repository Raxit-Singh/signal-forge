import type { Metadata } from "next";
import { getUser } from "@/lib/server/session";
import { createClient } from "@/lib/supabase/server";
import { planFromRow, type PlanRow } from "@/lib/domain/plans";
import { Landing } from "@/components/landing/landing";
import { INDEXED } from "@/lib/marketing";

export const metadata: Metadata = {
  title: { absolute: "Heardex · Heard. Indexed. Fixed." },
  robots: INDEXED,
  description: "Heardex finds what people say about your product across Reddit, Hacker News, GitHub, app stores and more, and ranks it into bugs, requests and complaints.",
};

export default async function Home() {
  const supabase = await createClient();
  // The public plans, as the billing page lists them; if they can't be read the page simply has no pricing.
  const [user, { data: rows }] = await Promise.all([
    getUser(),
    supabase.from("plans").select("*").eq("is_public", true).order("sort_order"),
  ]);
  const plans = (rows ?? []).map((r) => planFromRow(r as PlanRow)).filter((p) => !p.retired);
  return <Landing signedIn={Boolean(user)} plans={plans} />;
}
