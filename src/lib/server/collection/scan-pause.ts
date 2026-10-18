import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** "infinity" in Postgres: a search that never comes due (Stop scan). */
export const NEVER = "infinity";

/**
 * True while scanning is stopped for this product (Stop scan) — or, for a
 * competitor's tracking product, for the product it belongs to.
 */
export async function scanStopped(admin: SupabaseClient, productId: string): Promise<boolean> {
  const { data } = await admin.from("products").select("scan_paused_at, competitor_of").eq("id", productId).maybeSingle();
  if (!data) return false;
  if (data.scan_paused_at) return true;
  if (!data.competitor_of) return false;
  const { data: parent } = await admin.from("products").select("scan_paused_at").eq("id", data.competitor_of as string).maybeSingle();
  return Boolean(parent?.scan_paused_at);
}
