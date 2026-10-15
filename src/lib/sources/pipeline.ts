// Turns adapter output into rows for `svc_ingest_mentions`:
// relevance filter → content hash → wire format. Pure and deterministic.

import { evaluateRelevance, type AliasRule, type RuleStatus } from "./relevance.ts";
import { contentHash, httpsUrl } from "./text.ts";
import type { CandidateMention, CollectionMethod, DataProvider, LinkTarget, MentionType } from "./types.ts";

export interface IngestItem {
  external_id: string;
  source_url: string;
  parent_external_id: string | null;
  author_external_id: string | null;
  author_display: string | null;
  title: string | null;
  content: string | null;
  content_hash: string | null;
  language: string | null;
  published_at: string;
  engagement: Record<string, number>;
  engagement_score: number;
  matched_terms: string[];
  relevance_score: number;
  relevance_status: RuleStatus;
  linked_url: string | null;
  retain_until: string | null;
  mention_type: MentionType;
  collection_method: CollectionMethod;
  data_provider: DataProvider;
  community: string | null;
  link_target: LinkTarget;
  published_at_estimated: boolean;
  /** Not stored: which paid request returned the item (per-request accounting). */
  origin_request_id?: string | null;
}

export interface PrepareResult {
  items: IngestItem[];
  /** Candidates the source returned. */
  fetched: number;
  /** Dropped by relevance rules (no keyword, ambiguous without context, excluded). */
  filtered: number;
  /** Dropped as malformed (bad URL / date). */
  invalid: number;
}

export function prepareIngest(
  candidates: CandidateMention[],
  rules: AliasRule[],
  opts: { retentionDays?: number; now: Date },
): PrepareResult {
  const items: IngestItem[] = [];
  let filtered = 0;
  let invalid = 0;
  const retainUntil = opts.retentionDays
    ? new Date(opts.now.getTime() + opts.retentionDays * 86_400_000).toISOString()
    : null;

  for (const c of candidates) {
    const url = httpsUrl(c.sourceUrl);
    if (!url || Number.isNaN(c.publishedAt.getTime()) || !c.externalId) {
      invalid++;
      continue;
    }
    const match = c.directlyAbout
      ? { matchedTerms: [c.directlyAbout.reason.slice(0, 100)], score: c.directlyAbout.score, status: "relevant" as RuleStatus }
      : evaluateRelevance(rules, c.matchText, c.contextText);
    if (!match) {
      filtered++;
      continue;
    }
    items.push({
      external_id: c.externalId.slice(0, 300),
      source_url: url,
      parent_external_id: c.parentExternalId?.slice(0, 300) ?? null,
      author_external_id: c.authorExternalId?.slice(0, 300) ?? null,
      author_display: c.authorDisplay?.slice(0, 200) ?? null,
      title: c.title?.slice(0, 500) ?? null,
      content: c.content?.slice(0, 20000) ?? null,
      // Hash what the item says, not its title: "Re: <story>" titles are shared by every comment.
      content_hash: contentHash(c.content),
      language: c.language?.slice(0, 16) ?? null,
      // Never record a future publication time (clock skew on the source).
      published_at: new Date(Math.min(c.publishedAt.getTime(), opts.now.getTime())).toISOString(),
      engagement: c.engagement,
      engagement_score: Math.max(0, Math.round(c.engagementScore)),
      matched_terms: match.matchedTerms,
      relevance_score: match.score,
      relevance_status: match.status,
      linked_url: c.linkedUrl ?? null,
      retain_until: retainUntil,
      mention_type: c.mentionType ?? "post",
      collection_method: c.collectionMethod ?? "keyword_search",
      data_provider: c.dataProvider ?? "official",
      community: c.community?.slice(0, 200) ?? null,
      link_target: c.linkTarget ?? "item",
      published_at_estimated: c.publishedAtEstimated ?? false,
      origin_request_id: c.originRequestId ?? null,
    });
  }
  return { items, fetched: candidates.length, filtered, invalid };
}
