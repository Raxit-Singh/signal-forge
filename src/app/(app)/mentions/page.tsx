import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, ExternalLink, MessageSquareText, PackagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, hasRole, requireWorkspace } from "@/lib/server/session";
import { getCoverageSummary } from "@/lib/server/collection/status";
import { parseRange } from "@/lib/domain/date-range";
import { integrationInfo } from "@/lib/domain/integrations";
import { PUBLIC_SOURCES, isPublicSource } from "@/lib/sources/registry";
import { formatCount, formatRelative, formatUtc } from "@/lib/format";
import { pageCount, pageHref, pageItems, pageRange, parsePage } from "@/lib/pagination";
import { CoverageNotice, EmptyState, PageHeader } from "@/components/page";
import { Badge, Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { StartScanButton } from "@/components/scan/scan-controls";
import { cn } from "@/lib/utils";
import { ExpandableText, MentionFilters, RelevanceButtons } from "./mention-client";

export const metadata: Metadata = { title: "Mentions" };
// "Scan now" keeps working after the action responds.
export const maxDuration = 60;

const PAGE_SIZE = 20;

type SearchParams = Record<string, string | undefined>;

interface MentionRow {
  id: string;
  source: string;
  source_url: string;
  title: string | null;
  content: string | null;
  language: string | null;
  author_display: string | null;
  published_at: string;
  published_at_estimated: boolean;
  discovered_at: string;
  engagement: Record<string, number>;
  matched_terms: string[];
  relevance_status: string;
  dedup_kind: string;
  mention_type: string;
  link_target: string;
  community: string | null;
}

const STATUS_FILTER: Record<string, string[] | null> = {
  "": ["relevant", "pending", "user_relevant"],
  review: ["pending"],
  relevant: ["relevant", "user_relevant"],
  irrelevant: ["irrelevant", "user_irrelevant"],
  all: null,
};

const MENTION_TYPES: Record<string, string> = {
  post: "Post", comment: "Comment", reply: "Reply", quote: "Quote", video: "Video",
  review: "Review", article: "Article", note: "Note", community_message: "Message",
};

const ENGAGEMENT_LABEL: Record<string, [string, string]> = {
  points: ["point", "points"], comments: ["comment", "comments"], reactions: ["reaction", "reactions"],
  score: ["score", "score"], answers: ["answer", "answers"], views: ["view", "views"],
  likes: ["like", "likes"], replies: ["reply", "replies"],
};

const STATUS_BADGE: Record<string, { tone: "positive" | "warning" | "negative" | "neutral"; label: string; title: string }> = {
  relevant: { tone: "neutral", label: "Keyword match", title: "Matched your keywords (rule-based, not reviewed)" },
  pending: { tone: "warning", label: "Needs review", title: "Matched an ambiguous keyword or only the surrounding thread" },
  user_relevant: { tone: "positive", label: "Relevant", title: "Marked relevant by your team" },
  user_irrelevant: { tone: "negative", label: "Not relevant", title: "Marked not relevant by your team" },
  irrelevant: { tone: "neutral", label: "Excluded", title: "Excluded by a negative keyword or context rule" },
};

const OPEN_LABEL: Record<string, string> = {
  item: "Open original", thread: "Open thread", shared_content: "Open shared link", listing: "Open listing",
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
  const type = sp.type && sp.type in MENTION_TYPES ? sp.type : null;
  const statusKey = sp.status && sp.status in STATUS_FILTER ? sp.status : "";
  const statuses = STATUS_FILTER[statusKey];
  const showDupes = sp.dupes === "1";
  const page = parsePage(sp.page);
  const canEdit = hasRole(workspace.role, "member");
  const canScan = hasRole(workspace.role, "admin");

  // Offset pagination over a deterministic order: (published_at desc, id desc), served by
  // mentions_product_published_id_idx. Exact count gives page numbers and "Showing x–y of n".
  const supabase = await createClient();
  const filteredQuery = (columns: string, head = false) => {
    let query = supabase
      .from("mentions")
      .select(columns, { count: "exact", head })
      .eq("product_id", product.id)
      .gte("published_at", range.from.toISOString())
      .lt("published_at", range.to.toISOString());
    if (source) query = query.eq("source", source);
    if (type) query = query.eq("mention_type", type);
    if (statuses) query = query.in("relevance_status", statuses);
    if (!showDupes) query = query.eq("dedup_kind", "original");
    // Values are double-quoted: they may contain "." or ":" (reserved in PostgREST filters).
    if (q) query = query.or(`title.ilike."*${q}*",content.ilike."*${q}*"`);
    return query;
  };
  const offset = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await filteredQuery(
    "id, source, source_url, title, content, language, author_display, published_at, published_at_estimated, discovered_at, engagement, matched_terms, relevance_status, dedup_kind, mention_type, link_target, community",
  )
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);
  let total = count ?? 0;
  if (error) {
    // PostgREST answers an offset past the end with 416 (PGRST103): count, then go to the last page.
    if (error.code !== "PGRST103") throw new Error(`Failed to load mentions: ${error.message}`);
    const { count: c } = await filteredQuery("id", true);
    total = c ?? 0;
  }
  const pages = pageCount(total, PAGE_SIZE);
  if (page > pages) redirect(pageHref("/mentions", sp, pages));

  const rows = (data ?? []) as unknown as MentionRow[];
  const filtered = Boolean(q || source || type || statusKey || showDupes);
  const coverage = await getCoverageSummary(product.id);
  const neverCollected = page === 1 && rows.length === 0 && !filtered && coverage.included.length === 0;
  const sources = PUBLIC_SOURCES.map((id) => ({ id, name: integrationInfo(id)?.name ?? id }));
  const shown = pageRange(page, PAGE_SIZE, total);

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
            Run a first scan to search {coverage.sources.filter((s) => s.state !== "not_configured" && s.state !== "not_enabled").map((s) => s.name).join(", ")} for
            the last 30 days. After that, monitoring runs automatically.
          </p>
          {canScan && <div className="mt-4 flex justify-center"><StartScanButton productId={product.id} kind="initial" /></div>}
        </EmptyState>
      ) : (
        <>
          <MentionFilters sources={sources} types={Object.entries(MENTION_TYPES).map(([id, name]) => ({ id, name }))} />
          <p className="mb-2 text-xs text-muted-foreground tabular" aria-live="polite">
            {total === 0
              ? "No mentions in this view"
              : `Showing ${formatCount(shown.from)}–${formatCount(shown.to)} of ${total.toLocaleString("en-US")} mention${total === 1 ? "" : "s"}`}
          </p>
          {rows.length === 0 ? (
            <EmptyState icon={MessageSquareText} title={filtered ? "No mentions match these filters" : "No mentions in this date range"}>
              {filtered
                ? "Try another platform, type, relevance filter or search term."
                : "Nothing that matched your keywords was published in this period on the included sources. Try a longer range."}
            </EmptyState>
          ) : (
            <Card className="p-0">
              <ul aria-label="Mentions" className="divide-y">
                {rows.map((m) => <MentionItem key={m.id} m={m} canEdit={canEdit} />)}
              </ul>
            </Card>
          )}
          {pages > 1 && <Pagination page={page} pages={pages} params={sp} />}
        </>
      )}
    </>
  );
}

function Pagination({ page, pages, params }: { page: number; pages: number; params: SearchParams }) {
  const href = (p: number) => pageHref("/mentions", params, p);
  const items = pageItems(page, pages);
  const edge = "h-9 sm:h-8";
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-2 sm:justify-center">
      {page > 1 ? (
        <Button asChild variant="ghost" size="sm" className={edge}>
          <Link href={href(page - 1)} rel="prev"><ChevronLeft aria-hidden />Previous</Link>
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className={edge} disabled aria-disabled="true"><ChevronLeft aria-hidden />Previous</Button>
      )}
      <ol className="hidden items-center gap-1 sm:flex">
        {items.map((it) =>
          typeof it === "number" ? (
            <li key={it}>
              <Link
                href={href(it)}
                aria-label={`Page ${it}`}
                aria-current={it === page ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-[13px] tabular hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
                  it === page && "bg-primary font-medium text-primary-foreground hover:bg-primary",
                )}
              >
                {it}
              </Link>
            </li>
          ) : (
            <li key={it} aria-hidden className="px-1 text-muted-foreground">…</li>
          ),
        )}
      </ol>
      <span className="text-[13px] text-muted-foreground tabular sm:hidden">Page {page} of {pages}</span>
      {page < pages ? (
        <Button asChild variant="ghost" size="sm" className={edge}>
          <Link href={href(page + 1)} rel="next">Next<ChevronRight aria-hidden /></Link>
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className={edge} disabled aria-disabled="true">Next<ChevronRight aria-hidden /></Button>
      )}
    </nav>
  );
}

function MentionItem({ m, canEdit }: { m: MentionRow; canEdit: boolean }) {
  const name = integrationInfo(m.source as never)?.name.replace(/ \/ Stack Exchange$/, "") ?? m.source;
  const late = new Date(m.discovered_at).getTime() - new Date(m.published_at).getTime() > 86_400_000;
  const engagement = Object.entries(m.engagement ?? {}).filter(([k, v]) => ENGAGEMENT_LABEL[k] && typeof v === "number");
  const status = STATUS_BADGE[m.relevance_status];
  const title = m.title?.trim() || null;
  const body = m.content && m.content.trim() !== title ? m.content : null;

  return (
    <li className="grid gap-1.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Badge tone="info">{name}</Badge>
        {m.mention_type !== "post" && <Badge>{MENTION_TYPES[m.mention_type] ?? m.mention_type}</Badge>}
        {m.community && <span className="max-w-40 truncate">{m.community}</span>}
        {m.author_display && <span className="max-w-48 truncate font-medium text-foreground/80">{m.author_display}</span>}
        <time dateTime={m.published_at} title={`${m.published_at_estimated ? "Found" : "Published"} ${formatUtc(m.published_at)}`}>
          {m.published_at_estimated ? "found " : ""}{formatRelative(m.published_at)}
        </time>
        {late && !m.published_at_estimated && <span title={`Discovered ${formatUtc(m.discovered_at)}`}>· found {formatRelative(m.discovered_at)}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {status && <Badge tone={status.tone} title={status.title}>{status.label}</Badge>}
          {m.dedup_kind === "exact_duplicate" && <Badge title="Same text as an earlier mention; not counted as a separate report">Duplicate</Badge>}
          {m.dedup_kind === "repost" && <Badge title="Shares the same link as an earlier post">Repost</Badge>}
        </span>
      </div>

      {title && <h3 className="line-clamp-2 text-sm font-medium leading-snug" dir="auto" lang={m.language ?? undefined}>{title}</h3>}
      {body && <ExpandableText text={body} lang={m.language} />}

      {m.matched_terms.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>Matched</span>
          {m.matched_terms.map((t) => <code key={t} className="rounded bg-muted px-1 font-mono text-[11px] text-foreground/80">{t}</code>)}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        {engagement.map(([k, v]) => (
          <span key={k} className="tabular">{formatCount(v)} {ENGAGEMENT_LABEL[k]![v === 1 ? 0 : 1]}</span>
        ))}
        <a
          href={m.source_url}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="inline-flex min-h-9 items-center gap-1 font-medium text-foreground hover:underline sm:min-h-0"
          aria-label={`${OPEN_LABEL[m.link_target] ?? "Open original"} on ${name}${title ? `: ${title}` : ""} (opens in a new tab)`}
        >
          {OPEN_LABEL[m.link_target] ?? "Open original"}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
        {canEdit && (
          <span className="ml-auto">
            <RelevanceButtons mentionId={m.id} status={m.relevance_status} />
          </span>
        )}
      </div>
    </li>
  );
}
