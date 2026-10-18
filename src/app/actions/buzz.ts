"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { totals } from "@/lib/server/analytics/buzz";

export interface SpikeDetails {
  ok: boolean;
  platforms: Array<{ id: string; mentions: number }>;
  keywords: Array<{ keyword: string; mentions: number }>;
  mentions: Array<{ id: string; source: string; title: string; url: string; publishedAt: string }>;
}

const payload = z.object({
  productId: z.uuid(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  platform: z.string().max(40).nullable(),
  keyword: z.string().max(100).nullable(),
});

/**
 * What made up one spike period: contributing platforms and keywords and the
 * most engaged relevant mentions. Stored data only (no API or AI calls), read
 * through the caller's RLS, so other workspaces' products return nothing.
 */
export async function spikeDetailsAction(input: z.input<typeof payload>): Promise<SpikeDetails> {
  const empty: SpikeDetails = { ok: false, platforms: [], keywords: [], mentions: [] };
  const p = payload.safeParse(input);
  if (!p.success) return empty;
  const { productId, start, end, platform, keyword } = p.data;
  const from = new Date(start);
  const to = new Date(end);
  if (!(to > from) || to.getTime() - from.getTime() > 7 * 86_400_000) return empty;

  const sb = await createClient();
  let q = sb.from("mentions").select("id, source, title, content, source_url, published_at")
    .eq("product_id", productId).eq("dedup_kind", "original").in("relevance_status", ["relevant", "user_relevant"])
    .gte("published_at", from.toISOString()).lt("published_at", to.toISOString())
    .order("engagement_score", { ascending: false }).limit(8);
  if (platform) q = q.eq("source", platform);
  if (keyword) q = q.overlaps("matched_terms", [...new Set([keyword, keyword.toLowerCase()])]);
  try {
    const [t, kw, m] = await Promise.all([
      totals(sb, productId, from, to, platform ? [platform] : null),
      sb.rpc("keyword_platform_counts", { p_product_id: productId, p_from: from.toISOString(), p_to: to.toISOString() }),
      q,
    ]);
    const byKeyword = new Map<string, number>();
    for (const r of (kw.data ?? []) as Array<{ keyword: string; platform: string; mentions: number }>) {
      if (platform && r.platform !== platform) continue;
      byKeyword.set(r.keyword, (byKeyword.get(r.keyword) ?? 0) + Number(r.mentions));
    }
    return {
      ok: true,
      platforms: t.bySource.map((r) => ({ id: r.source, mentions: Number(r.relevant) })).filter((r) => r.mentions > 0).sort((a, b) => b.mentions - a.mentions),
      keywords: [...byKeyword].map(([k, n]) => ({ keyword: k, mentions: n })).sort((a, b) => b.mentions - a.mentions),
      mentions: ((m.data ?? []) as Array<{ id: string; source: string; title: string | null; content: string | null; source_url: string; published_at: string }>).map((r) => ({
        id: r.id, source: r.source, url: r.source_url, publishedAt: r.published_at,
        title: (r.title || r.content || "(no text)").replace(/\s+/g, " ").slice(0, 160),
      })),
    };
  } catch {
    return empty;
  }
}
