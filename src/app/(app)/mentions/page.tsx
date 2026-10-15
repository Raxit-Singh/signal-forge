import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ExternalLink, MessageSquareText, PackagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, hasRole, requireWorkspace } from "@/lib/server/session";
import { getCoverageSummary } from "@/lib/server/collection/status";
import { parseRange } from "@/lib/domain/date-range";
import { integrationInfo } from "@/lib/domain/integrations";
import { PUBLIC_SOURCES, isPublicSource } from "@/lib/sources/registry";
import { decodeCursor, encodeCursor, formatCount, formatRelative, formatUtc } from "@/lib/format";
import { CoverageNotice, EmptyState, PageHeader } from "@/components/page";
import { Badge, Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { StartScanButton } from "@/components/scan/scan-controls";
import { MentionFilters, RelevanceButtons } from "./mention-client";

export const metadata: Metadata = { title: "Mentions" };
// "Scan now" keeps working after the action responds.
export const maxDuration = 60;

const PAGE_SIZE = 25;

type SearchParams = Record<string, string | undefined>;

interface MentionRow {
  id: string;
  source: string;
  source_url: string;
  title: string | null;
  content: string | null;
  author_display: string | null;
  published_at: string;
  discovered_at: string;
  engagement: Record<string, number>;
  matched_terms: string[];
  relevance_score: number | null;
  relevance_status: string;
  dedup_kind: string;
}

const STATUS_FILTER: Record<string, string[] | null> = {
  "": ["relevant", "pending", "user_relevant"],
  review: ["pending"],
  relevant: ["relevant", "user_relevant"],
  irrelevant: ["irrelevant", "user_irrelevant"],
  all: null,
};

const ENGAGEMENT_LABEL: Record<string, [string, string]> = {
  points: ["point", "points"], comments: ["comment", "comments"], reactions: ["reaction", "reactions"],
  score: ["score", "score"], answers: ["answer", "answers"], views: ["view", "views"],
  likes: ["like", "likes"], replies: ["reply", "replies"],
};

/** Strips characters with meaning in PostgREST filter syntax. */
function safeSearch(q: string | undefined) {
  return (q ?? "").replace(/[,()*%\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

export default async function MentionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  const sp = await searchParams;

  if (!product) {
    return (
      <>
        <PageHeader title="Mentions" />
        <EmptyState icon={PackagePlus} title="Add a product first" action={{ href: "/onboarding/product", label: "Add product" }}>
          Mentions are collected per product.
        </EmptyState>
      </>
    );
  }

  const range = parseRange(sp, new Date());
  const q = safeSearch(sp.q);
  const source = sp.source && isPublicSource(sp.source) ? sp.source : null;
  const statusKey = sp.status && sp.status in STATUS_FILTER ? sp.status : "";
  const statuses = STATUS_FILTER[statusKey];
  const showDupes = sp.dupes === "1";
  const cursor = decodeCursor(sp.cursor);
  const canEdit = hasRole(workspace.role, "member");
  const canScan = hasRole(workspace.role, "admin");

  const supabase = await createClient();
  let query = supabase
    .from("mentions")
    .select(
      "id, source, source_url, title, content, author_display, published_at, discovered_at, engagement, matched_terms, relevance_score, relevance_status, dedup_kind",
      cursor ? undefined : { count: "exact" },
    )
    .eq("product_id", product.id)
    .gte("published_at", range.from.toISOString())
    .lt("published_at", range.to.toISOString());
  if (source) query = query.eq("source", source);
  if (statuses) query = query.in("relevance_status", statuses);
  if (!showDupes) query = query.eq("dedup_kind", "original");
  // Values are double-quoted: they may contain "." or ":" (reserved in PostgREST filters).
  if (q) query = query.or(`title.ilike."*${q}*",content.ilike."*${q}*"`);
  if (cursor) {
    const p = `"${cursor.publishedAt}"`;
    query = query.or(`published_at.lt.${p},and(published_at.eq.${p},id.lt.${cursor.id})`);
  }
  const { data, count, error } = await query
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (error) throw new Error(`Failed to load mentions: ${error.message}`);

  const rows = (data ?? []) as MentionRow[];
  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  const nextHref = hasMore && last
    ? `/mentions?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v !== undefined)) as Record<string, string>, cursor: encodeCursor(last.published_at, last.id) })}`
    : null;
  const firstHref = cursor
    ? `/mentions?${new URLSearchParams(Object.fromEntries(Object.entries(sp).filter(([k, v]) => k !== "cursor" && v !== undefined)) as Record<string, string>)}`
    : null;

  const filtered = Boolean(q || source || statusKey || showDupes);
  const coverage = await getCoverageSummary(product.id);
  const neverCollected = !cursor && rows.length === 0 && !filtered && coverage.included.length === 0;
  const sources = PUBLIC_SOURCES.map((id) => ({ id, name: integrationInfo(id)?.name ?? id }));

  return (
    <>
      <PageHeader
        title="Mentions"
        description={<>Conversations matching {product.name}&apos;s keywords · {range.label}</>}
        actions={canScan && !neverCollected ? <StartScanButton productId={product.id} kind="manual" variant="secondary" size="sm" /> : undefined}
      />
      <CoverageNotice />

      {neverCollected ? (
        <EmptyState icon={MessageSquareText} title="No mentions collected yet">
          <p>
            Run a first scan to search {coverage.sources.filter((s) => s.state !== "not_configured").map((s) => s.name).join(", ")} for
            the last 30 days. After that, monitoring runs automatically.
          </p>
          {canScan && <div className="mt-4 flex justify-center"><StartScanButton productId={product.id} kind="initial" /></div>}
        </EmptyState>
      ) : (
        <>
          <MentionFilters sources={sources} />
          {count !== null && count !== undefined && (
            <p className="mb-2 text-xs text-muted-foreground tabular" aria-live="polite">
              {count === 0 ? "No mentions" : `${formatCount(count)} mention${count === 1 ? "" : "s"}`} in this view
            </p>
          )}
          {page.length === 0 ? (
            <EmptyState icon={MessageSquareText} title={filtered ? "No mentions match these filters" : "No mentions in this date range"}>
              {filtered
                ? "Try another source, relevance filter or search term."
                : "Nothing that matched your keywords was published in this period on the included sources. Try a longer range."}
            </EmptyState>
          ) : (
            <Card className="divide-y p-0">
              <ul aria-label="Mentions" className="divide-y">
                {page.map((m) => <MentionItem key={m.id} m={m} canEdit={canEdit} />)}
              </ul>
            </Card>
          )}
          {(nextHref || firstHref) && (
            <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-2">
              {firstHref ? <Button asChild variant="ghost" size="sm"><Link href={firstHref}>Back to newest</Link></Button> : <span />}
              {nextHref && (
                <Button asChild variant="secondary" size="sm">
                  <Link href={nextHref}>Older <ArrowRight aria-hidden /></Link>
                </Button>
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}

function MentionItem({ m, canEdit }: { m: MentionRow; canEdit: boolean }) {
  const name = integrationInfo(m.source as never)?.name.replace(/ \/ Stack Exchange$/, "") ?? m.source;
  const late = new Date(m.discovered_at).getTime() - new Date(m.published_at).getTime() > 86_400_000;
  const linkText = m.title || (m.content ? m.content.split("\n")[0]!.slice(0, 120) : `View on ${name}`);
  const engagement = Object.entries(m.engagement ?? {}).filter(([k, v]) => ENGAGEMENT_LABEL[k] && typeof v === "number");

  return (
    <li className="grid gap-1.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Badge>{name}</Badge>
        {m.author_display && <span className="max-w-48 truncate">{m.author_display}</span>}
        <time dateTime={m.published_at} title={`Published ${formatUtc(m.published_at)}`}>{formatRelative(m.published_at)}</time>
        {late && <span title={`Discovered ${formatUtc(m.discovered_at)}`}>· found {formatRelative(m.discovered_at)}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {m.relevance_status === "pending" && <Badge tone="warning" title="Matched an ambiguous keyword or only the surrounding thread">Needs review</Badge>}
          {m.relevance_status === "user_relevant" && <Badge tone="positive">Marked relevant</Badge>}
          {(m.relevance_status === "user_irrelevant" || m.relevance_status === "irrelevant") && <Badge tone="negative">Not relevant</Badge>}
          {m.dedup_kind === "exact_duplicate" && <Badge title="Same text as an earlier mention; not counted as a separate report">Duplicate</Badge>}
          {m.dedup_kind === "repost" && <Badge title="Shares the same link as an earlier post">Repost</Badge>}
        </span>
      </div>
      <a
        href={m.source_url}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
        className="group inline-flex items-start gap-1 font-medium leading-snug hover:underline"
      >
        <span className="line-clamp-2">{linkText}</span>
        <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-label="(opens in a new tab)" />
      </a>
      {m.content && m.content !== linkText && (
        <p className="line-clamp-3 whitespace-pre-line text-[13px] text-muted-foreground">{m.content}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {engagement.map(([k, v]) => (
          <span key={k} className="tabular">{formatCount(v)} {ENGAGEMENT_LABEL[k]![v === 1 ? 0 : 1]}</span>
        ))}
        {m.matched_terms.length > 0 && (
          <span>
            matched{" "}
            {m.matched_terms.map((t) => <code key={t} className="mr-1 rounded bg-muted px-1 font-mono text-[11px]">{t}</code>)}
          </span>
        )}
        {canEdit && (
          <span className="ml-auto">
            <RelevanceButtons mentionId={m.id} status={m.relevance_status} />
          </span>
        )}
      </div>
    </li>
  );
}
