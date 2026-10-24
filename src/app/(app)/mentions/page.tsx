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
import { formatCount, formatRelative, formatTime } from "@/lib/format";
import { getTimeZone } from "@/lib/server/timezone";
import { pageCount, pageHref, pageItems, pageRange, parsePage } from "@/lib/pagination";
import { CoverageNotice, EmptyState, PageHeader } from "@/components/page";
import { Badge, Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { categoryLabel } from "@/lib/ai/cluster";
import type { FeedbackCategory } from "@/lib/ai/types";
import { ExpandableText, MentionFilters, NewMentionsNotice, RelevanceButtons } from "./mention-client";
import { FEEDBACK_FILTERS, isFeedbackFilter } from "@/lib/domain/feedback-filter";

export const metadata: Metadata = { title: "Mentions" };

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
  sentiment: string | null;
  feedback_category: string | null;
  ai_about_product: string | null;
  ai_reason: string | null;
  ai_model: string | null;
}

const SENTIMENT_TONE: Record<string, "positive" | "negative" | "warning" | "neutral"> = {
  positive: "positive", negative: "negative", mixed: "warning", neutral: "neutral",
};

const STATUS_FILTER: Record<string, string[] | null> = {
  "": ["relevant", "pending", "user_relevant"],
  review: ["pending"],
  relevant: ["relevant", "user_relevant"],
  irrelevant: ["irrelevant", "user_irrelevant"],
  all: null,
};

const SENTIMENTS: Record<string, { label: string; values: string[] }> = {
  negative: { label: "Negative", values: ["negative"] },
  positive: { label: "Positive", values: ["positive"] },
  neutral: { label: "Neutral or mixed", values: ["neutral", "mixed"] },
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
  const tz = await getTimeZone();
  const at = (d: string | Date) => formatTime(d, tz);
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
  const feedback = isFeedbackFilter(sp.feedback) ? sp.feedback : null;
  const sentiment = sp.sentiment && sp.sentiment in SENTIMENTS ? sp.sentiment : null;
  const page = parsePage(sp.page);
  const canEdit = hasRole(workspace.role, "member");
  const canScan = hasRole(workspace.role, "admin");
  const loadedAt = new Date().toISOString();

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
    if (sentiment) query = query.eq("processing_status", "classified").in("sentiment", SENTIMENTS[sentiment]!.values);
    // From Feedback Intelligence: the classified posts behind one of its counts.
    if (feedback) {
      query = query.eq("processing_status", "classified")
        .in("feedback_category", [...FEEDBACK_FILTERS[feedback].categories])
        .or("ai_about_product.is.null,ai_about_product.neq.no");
    }
    // Values are double-quoted: they may contain "." or ":" (reserved in PostgREST filters).
    if (q) query = query.or(`title.ilike."*${q}*",content.ilike."*${q}*"`);
    return query;
  };
  // The range at a glance (independent of the other filters): each tile is also a filter.
  const glance = (patch: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => patch(base());
  const base = () => supabase.from("mentions").select("id", { count: "exact", head: true })
    .eq("product_id", product.id).eq("dedup_kind", "original")
    .gte("published_at", range.from.toISOString()).lt("published_at", range.to.toISOString());
  const dayAgo = new Date(new Date(loadedAt).getTime() - 86_400_000).toISOString();
  const summaryP = Promise.all([
    glance((x) => x.in("relevance_status", STATUS_FILTER[""]!)),
    glance((x) => x.eq("relevance_status", "pending")),
    glance((x) => x.in("relevance_status", STATUS_FILTER[""]!).eq("processing_status", "classified").eq("sentiment", "negative")),
    glance((x) => x.in("relevance_status", STATUS_FILTER[""]!).gte("published_at", dayAgo)),
  ]);
  const offset = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await filteredQuery(
    "id, source, source_url, title, content, language, author_display, published_at, published_at_estimated, discovered_at, engagement, matched_terms, relevance_status, dedup_kind, mention_type, link_target, community, sentiment, feedback_category, ai_about_product, ai_reason, ai_model",
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
  const filtered = Boolean(q || source || type || statusKey || showDupes || feedback || sentiment);
  const [coverage, summary] = await Promise.all([getCoverageSummary(product.id), summaryP]);
  const [inRange = 0, review = 0, negative = 0, lastDay = 0] = summary.map((r) => r.count ?? 0);
  const neverCollected = page === 1 && rows.length === 0 && !filtered && coverage.included.length === 0;
  const sources = PUBLIC_SOURCES.map((id) => ({ id, name: integrationInfo(id)?.name ?? id }));
  const shown = pageRange(page, PAGE_SIZE, total);

  return (
    <>
      <PageHeader
        title="Mentions"
        description={<>Conversations matching {product.name}&apos;s keywords · {range.label.toLowerCase()}</>}
      />
      <CoverageNotice />

      {neverCollected ? (
        <EmptyState icon={MessageSquareText} title="No mentions collected yet">
          <p>
            Start a historical search of {coverage.sources.filter((s) => s.state !== "not_configured" && s.state !== "not_enabled").map((s) => s.name).join(", ")} —
            you choose how far back. After that, monitoring runs automatically.
          </p>
          {canScan && (
            <div className="mt-4 flex justify-center">
              <Button asChild><Link href="/monitoring#history">Search history</Link></Button>
            </div>
          )}
        </EmptyState>
      ) : (
        <>
          <section aria-label="This period at a glance" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Glance i={0} label="In this period" value={inRange} href={pageHref("/mentions", { ...sp, status: undefined, sentiment: undefined }, 1)} active={!statusKey && !sentiment} />
            <Glance i={1} label="Need review" value={review} href={pageHref("/mentions", { ...sp, status: "review", sentiment: undefined }, 1)} active={statusKey === "review"} hint="Ambiguous keyword matches" />
            <Glance i={2} label="Negative" value={negative} href={pageHref("/mentions", { ...sp, sentiment: "negative", status: undefined }, 1)} active={sentiment === "negative"} red hint={inRange > 0 ? `${Math.round((negative / inRange) * 100)}% of this period` : undefined} />
            <Glance i={3} label="Last 24 hours" value={lastDay} />
          </section>
          <MentionFilters
            sources={sources}
            types={Object.entries(MENTION_TYPES).map(([id, name]) => ({ id, name }))}
            sentiments={Object.entries(SENTIMENTS).map(([id, v]) => ({ id, name: v.label }))}
          />
          {feedback && (
            <p className="mb-2 flex flex-wrap items-center gap-2 text-[13px]" data-testid="feedback-filter">
              <Badge tone="info">{FEEDBACK_FILTERS[feedback].label}</Badge>
              <span className="text-muted-foreground">as classified by SignalForge Intelligence (from Feedback Intelligence)</span>
              <Link href="/mentions" className="underline underline-offset-4">Show all mentions</Link>
            </p>
          )}
          <NewMentionsNotice productId={product.id} page={page} loadedAt={loadedAt} />
          <p className="mb-2.5 flex items-center justify-between gap-3 px-1 text-[12px] text-muted-foreground tabular" >
            <span aria-live="polite">
              {total === 0
                ? "No mentions in this view"
                : `Showing ${formatCount(shown.from)}–${formatCount(shown.to)} of ${total.toLocaleString("en-US")} mention${total === 1 ? "" : "s"}`}
            </span>
            {total > 0 && <span className="hidden sm:inline">Newest first</span>}
          </p>
          {rows.length === 0 ? (
            <EmptyState icon={MessageSquareText} title={filtered ? "No mentions match these filters" : "No mentions in this date range"}>
              {filtered
                ? "Try another platform, type, relevance filter or search term."
                : "Nothing that matched your keywords was published in this period on the included sources. Try a longer range."}
            </EmptyState>
          ) : (
            <Card className="rise overflow-hidden p-0" style={{ ["--d" as string]: "200ms" }}>
              <ul aria-label="Mentions" className="divide-y divide-foreground/[0.06]">
                {rows.map((m) => <MentionItem key={m.id} m={m} canEdit={canEdit} at={at} />)}
              </ul>
            </Card>
          )}
          {pages > 1 && <Pagination page={page} pages={pages} params={sp} />}
        </>
      )}
    </>
  );
}

function Glance({ i, label, value, href, active, red, hint }: { i: number; label: string; value: number; href?: string; active?: boolean; red?: boolean; hint?: string }) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
        {red && <span className="size-1.5 rounded-full bg-signal shadow-[var(--signal-glow)]" aria-hidden />}{label}
      </span>
      <span className={cn("text-[28px] font-semibold leading-none tracking-[-0.03em] tabular", red && value > 0 && "text-signal")}>{value.toLocaleString("en-US")}</span>
      <span className="min-h-4 text-[12px] text-muted-foreground/80">{hint}</span>
    </>
  );
  const cls = cn("panel rise grid gap-2 rounded-[18px] p-4", href && "lift press", active && "border-foreground/25");
  const style = { ["--d" as string]: `${60 + i * 50}ms` };
  return href
    ? <Link href={href} scroll={false} aria-current={active ? "true" : undefined} className={cls} style={style}>{body}</Link>
    : <div className={cls} style={style}>{body}</div>;
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
                  "inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-[13px] tabular transition-colors hover:bg-foreground/[0.06] focus-visible:outline-2 focus-visible:outline-ring",
                  it === page && "bg-foreground font-medium text-background hover:bg-foreground",
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

function MentionItem({ m, canEdit, at }: { m: MentionRow; canEdit: boolean; at: (d: string) => string }) {
  const name = integrationInfo(m.source as never)?.name.replace(/ \/ Stack Exchange$/, "") ?? m.source;
  const late = new Date(m.discovered_at).getTime() - new Date(m.published_at).getTime() > 86_400_000;
  const engagement = Object.entries(m.engagement ?? {}).filter(([k, v]) => ENGAGEMENT_LABEL[k] && typeof v === "number");
  const status = STATUS_BADGE[m.relevance_status];
  const title = m.title?.trim() || null;
  const body = m.content && m.content.trim() !== title ? m.content : null;

  const neg = m.sentiment === "negative";
  return (
    <li className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 px-4 py-4 transition-colors hover:bg-foreground/[0.02] sm:px-5">
      {neg && <span className="absolute inset-y-4 left-0 w-[2px] rounded-r-full bg-signal shadow-[var(--signal-glow)]" aria-hidden />}
      <span
        className={cn("mt-0.5 flex size-9 items-center justify-center rounded-full border text-[12px] font-semibold",
          neg ? "border-signal/40 bg-signal-soft text-signal" : "bg-foreground/[0.04]")}
        aria-hidden
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <div className="grid min-w-0 gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
          <span className="font-medium text-foreground/90">{name}</span>
          {m.mention_type !== "post" && <Badge>{MENTION_TYPES[m.mention_type] ?? m.mention_type}</Badge>}
          {m.community && <span className="max-w-40 truncate">{m.community}</span>}
          {m.author_display && <span className="max-w-48 truncate">· {m.author_display}</span>}
          <span aria-hidden>·</span>
          <time dateTime={m.published_at} title={`${m.published_at_estimated ? "Found" : "Published"} ${at(m.published_at)}`}>
            {m.published_at_estimated ? "found " : ""}{formatRelative(m.published_at)}
          </time>
          {late && !m.published_at_estimated && <span title={`Discovered ${at(m.discovered_at)}`}>· found {formatRelative(m.discovered_at)}</span>}
          <span className="ml-auto flex flex-wrap items-center gap-1">
            {status && <Badge tone={status.tone} title={status.title}>{status.label}</Badge>}
            {m.dedup_kind === "exact_duplicate" && <Badge title="Same text as an earlier mention; not counted as a separate report">Duplicate</Badge>}
            {m.dedup_kind === "repost" && <Badge title="Shares the same link as an earlier post">Repost</Badge>}
          </span>
        </div>

        {title && <h3 className="line-clamp-2 text-[15px] font-medium leading-snug tracking-[-0.01em]" dir="auto" lang={m.language ?? undefined}>{title}</h3>}
        {body && <ExpandableText text={body} lang={m.language} />}

        {(m.ai_model || m.matched_terms.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            {m.ai_model && (
              <span className="flex flex-wrap items-center gap-1" data-testid="mention-ai-labels">
                <span className="text-muted-foreground" title={m.ai_reason ?? undefined}>{m.ai_model.startsWith("test:") ? "Test labels:" : "AI labels:"}</span>
                {m.sentiment && m.sentiment !== "uncertain" && <Badge tone={SENTIMENT_TONE[m.sentiment] ?? "neutral"}>{m.sentiment} toward product</Badge>}
                {m.sentiment === "uncertain" && <Badge>sentiment unclear</Badge>}
                {m.feedback_category && m.feedback_category !== "general_discussion" && <Badge tone="info">{categoryLabel(m.feedback_category as FeedbackCategory).replace(/s$/, "")}</Badge>}
                {m.ai_about_product === "no" && (
                  <Badge tone="warning" title={m.ai_reason ?? undefined}>Possibly not about this product — review</Badge>
                )}
              </span>
            )}
            {m.matched_terms.length > 0 && (
              <span className="flex flex-wrap items-center gap-1 text-muted-foreground">
                <span>Matched</span>
                {m.matched_terms.map((t) => <code key={t} className="rounded-full bg-foreground/[0.06] px-1.5 font-mono text-[11px] text-foreground/80">{t}</code>)}
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-0.5 text-[12px] text-muted-foreground">
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
      </div>
    </li>
  );
}
