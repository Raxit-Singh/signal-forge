import "server-only";
import { createClient } from "@/lib/supabase/server";
import { broadKeywords } from "@/lib/domain/keyword-risk";
import { normalizeWebsiteUrl } from "@/lib/domain/urls";
import type { HistoryFormProps } from "@/components/history/history-form";
import { getWorkspacePlan, getWorkspaceUsage } from "./session";
import { measuredDailyRate } from "./collection/backfill-status";

/** Everything the historical-search form needs, from the product's real keywords, plan and usage. */
export async function loadHistoryFormProps(productId: string): Promise<HistoryFormProps> {
  const supabase = await createClient();
  const { data: product } = await supabase.from("products").select("id, workspace_id, name, website_url, category").eq("id", productId).single();
  if (!product) throw new Error("Product not found");
  const [{ plan }, usage, { data: aliases }, measured] = await Promise.all([
    getWorkspacePlan(product.workspace_id),
    getWorkspaceUsage(product.workspace_id),
    supabase.from("product_aliases").select("term, context_terms").eq("product_id", product.id).eq("enabled", true),
    measuredDailyRate(product.id),
  ]);
  const parsed = product.website_url ? normalizeWebsiteUrl(product.website_url) : null;
  const domain = parsed?.ok ? parsed.value.domain : null;
  return {
    productId: product.id, planName: plan.name, planHistoryDays: plan.historyDays,
    allowance: usage?.mentionAllowance ?? plan.monthlyMentionLimit,
    allowanceRemaining: usage?.mentionsRemaining ?? plan.monthlyMentionLimit,
    broad: broadKeywords((aliases ?? []).map((a) => ({ term: a.term as string, contextTerms: (a.context_terms as string[] | null) ?? [] })),
      { name: product.name, domain, category: product.category }),
    measured, now: new Date().toISOString(),
  };
}
