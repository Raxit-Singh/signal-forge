import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, ExternalLink, ListChecks, MessageSquareText, PackagePlus, ThumbsDown, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, hasRole, requireWorkspace } from "@/lib/server/session";
import { getCoverageSummary } from "@/lib/server/collection/status";
import { parseRange } from "@/lib/domain/date-range";
import { integrationInfo } from "@/lib/domain/integrations";
import { PUBLIC_SOURCES, isPublicSource } from "@/lib/sources/registry";
import { formatCount, formatRelative, formatTime } from "@/lib/format";
import { getTimeZone } from "@/lib/server/timezone";
import { getBuzzDashboard } from "@/lib/server/analytics/buzz";
import { CountUp } from "@/components/motion";
import { Periods } from "@/components/periods";
import { pageCount, pageHref, pageItems, pageRange, parsePage } from "@/lib/pagination";
import { EmptyState, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/primitives";
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
    // From Issues: the classified posts behind one of its counts.
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
    glance((x) => x.in("relevance_status", STATUS_FILTER[""]!).eq("processing_status", "classified").eq("sentiment", "positive")),
  ]);
  // Volume per day (all and negative) and per platform, for the hero chart and platform cards.
  const shapeP = Promise.all([
    getBuzzDashboard(supabase, product.id, range, tz, null, new Date(loadedAt)),
    supabase.rpc("feedback_daily", { p_product_id: product.id, p_from: range.from.toISOString(), p_to: range.to.toISOString(), p_tz: tz }),
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
  const [coverage, summary, [dash, daily]] = await Promise.all([getCoverageSummary(product.id), summaryP, shapeP]);
  const [inRange = 0, review = 0, negative = 0, lastDay = 0, positive = 0] = summary.map((r) => r.count ?? 0);
  const negByDay = new Map(((daily.data ?? []) as Array<{ day: string; negative: number }>).map((r) => [r.day, Number(r.negative ?? 0)]));
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const dayLabel = new Intl.DateTimeFormat("en-US", dash.bucket === "hour" ? { hour: "numeric", timeZone: tz } : { weekday: "short", month: "short", day: "numeric", timeZone: tz });
  const bars = dash.series.map((p) => ({
    label: dayLabel.format(new Date(p.start)),
    all: p.relevant ?? 0,
    negative: dash.bucket === "hour" ? 0 : Math.min(p.relevant ?? 0, negByDay.get(dayKey.format(new Date(p.start))) ?? 0),
  }));
  const platformTotal = dash.totals.bySource.reduce((t, r) => t + Number(r.relevant), 0);
  const platforms = dash.totals.bySource.map((r) => ({ id: r.source, value: Number(r.relevant) })).filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value).slice(0, 5)
    .map((r) => ({ ...r, name: integrationInfo(r.id as never)?.name.replace(/ \/ Stack Exchange$/, "").replace(/ \((Twitter|Google Search|Google News)\)$/, "") ?? r.id, share: r.value / Math.max(1, platformTotal) }));
  const neverCollected = page === 1 && rows.length === 0 && !filtered && coverage.included.length === 0;
  const sources = PUBLIC_SOURCES.map((id) => ({ id, name: integrationInfo(id)?.name ?? id }));
  const shown = pageRange(page, PAGE_SIZE, total);

  const pct = (n: number) => (inRange > 0 ? `${Math.round((n / inRange) * 100)}%` : "—");
  const href = (patch: SearchParams) => pageHref("/mentions", { ...sp, ...patch }, 1);

  return (
    <>

      {neverCollected ? (
        <>
          <PageHeader title="Mentions" description={<>Conversations matching {product.name}&apos;s keywords</>} />
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
        </>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 pb-10">
          {/* Hero: the period's volume, its tone, and the day-by-day shape. */}
          <section className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="rise grid content-start gap-5">
              <div className="grid gap-1.5">
                <h1 className="text-[34px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]">Mentions</h1>
                <p className="text-[14px] text-muted-foreground">Conversations matching {product.name}&apos;s keywords · {range.label.toLowerCase()}</p>
              </div>
              <div className="grid gap-2">
                <CountUp value={inRange} className="text-[56px] font-semibold leading-none tracking-[-0.045em] sm:text-[64px]" />
                <p className="text-[14px] text-muted-foreground">
                  Negative <span className="text-signal">{pct(negative)}</span> · Positive <span className="text-foreground">{pct(positive)}</span> · {lastDay.toLocaleString("en-US")} in the last 24 hours
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {review > 0 ? (
                  <Link href={href({ status: "review", sentiment: undefined })} scroll={false}
                    className="press flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[14px] font-medium text-primary-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_8px_24px_-8px_color-mix(in_oklab,var(--signal)_80%,transparent)]">
                    <ListChecks className="size-4" aria-hidden />Review {review.toLocaleString("en-US")} {review === 1 ? "match" : "matches"}
                  </Link>
                ) : (
                  <Link href={href({ sentiment: "negative", status: undefined })} scroll={false}
                    className="press flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[14px] font-medium text-primary-foreground">
                    <ThumbsDown className="size-4" aria-hidden />Read negative mentions
                  </Link>
                )}
                <Link href="/buzz" className="press panel flex h-11 items-center gap-2 rounded-full px-5 text-[14px] transition-colors hover:bg-foreground/[0.06]">
                  <TrendingUp className="size-4" aria-hidden />Trends
                </Link>
              </div>
            </div>
            <div className="rise grid content-between gap-5" style={{ ["--d" as string]: "120ms" }}>
              <div className="flex justify-end">
                <Periods value={range.custom ? "custom" : range.key} />
              </div>
              <DailyBars bars={bars} />
            </div>
          </section>

          {/* Platforms: where the conversation is; each card filters the list. */}
          {platforms.length > 0 && (
            <nav aria-label="Platforms" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <PlatformCard i={0} name="All platforms" value={platformTotal} share={1} href={href({ source: undefined })} active={!source} />
              {platforms.map((pl, i) => (
                <PlatformCard key={pl.id} i={i + 1} name={pl.name} value={pl.value} share={pl.share} href={href({ source: pl.id })} active={source === pl.id} />
              ))}
            </nav>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <MentionFilters
              sources={sources}
              types={Object.entries(MENTION_TYPES).map(([id, name]) => ({ id, name }))}
              sentiments={Object.entries(SENTIMENTS).map(([id, v]) => ({ id, name: v.label }))}
              counts={{ all: inRange, review, negative, positive }}
            />
            {feedback && (
              <p className="flex flex-wrap items-center gap-2 text-[13px]" data-testid="feedback-filter">
                <Badge tone="info">{FEEDBACK_FILTERS[feedback].label}</Badge>
                <span className="text-muted-foreground">as classified by SignalForge Intelligence (from Issues)</span>
                <Link href="/mentions" className="underline underline-offset-4">Show all mentions</Link>
              </p>
            )}
            <NewMentionsNotice productId={product.id} page={page} loadedAt={loadedAt} />
            <p className="flex items-center justify-between gap-3 px-1 text-[12px] text-muted-foreground tabular">
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
              <ul aria-label="Mentions" className="grid items-stretch gap-3 2xl:grid-cols-2">
                {rows.map((m, i) => <MentionItem key={m.id} i={i} m={m} canEdit={canEdit} at={at} />)}
              </ul>
            )}
            {pages > 1 && <Pagination page={page} pages={pages} params={sp} />}
          </div>
        </div>
      )}
    </>
  );
}

/** Mentions per day as capsules; the negative share of each day fills from the bottom in red. */
function DailyBars({ bars }: { bars: Array<{ label: string; all: number; negative: number }> }) {
  if (bars.length === 0) return <div style={{ height: 170 }} className="grid place-content-center rounded-2xl border border-dashed text-[13px] text-muted-foreground">No mentions in this period yet.</div>;
  const max = Math.max(1, ...bars.map((b) => b.all));
  const peak = bars.reduce((p, b, i) => (b.all > bars[p]!.all ? i : p), 0);
  return (
    <div className="grid gap-2 overflow-x-clip">
      <div className="flex items-end gap-[3px] sm:gap-1" style={{ height: 170 }} role="img" aria-label={`Mentions per day; busiest ${bars[peak]!.label} with ${bars[peak]!.all}`}>
        {bars.map((b, i) => (
          <div key={i} className="group relative flex h-full min-w-0 flex-1 items-end">
            <span className="relative block w-full overflow-hidden rounded-full bg-gradient-to-b from-foreground/[0.55] to-foreground/[0.18] grow-y"
              style={{ height: `${Math.max(3, (b.all / max) * 100)}%`, ["--d" as string]: `${300 + i * 18}ms` }}>
              {b.negative > 0 && (
                <span className="absolute inset-x-0 bottom-0 rounded-full bg-gradient-to-b from-[color-mix(in_oklab,var(--signal)_75%,white)] to-signal shadow-[0_0_14px_color-mix(in_oklab,var(--signal)_55%,transparent)]"
                  style={{ height: `${(b.negative / Math.max(1, b.all)) * 100}%` }} />
              )}
            </span>
            <span className={cn("pointer-events-none invisible absolute bottom-full z-10 mb-2 w-max rounded-lg border bg-surface/95 px-2.5 py-1.5 text-[11px] opacity-0 shadow-xl transition-opacity duration-150 group-hover:visible group-hover:opacity-100",
              i < bars.length / 2 ? "left-0" : "right-0")}>
              <span className="block text-muted-foreground">{b.label}</span>
              <span className="block tabular-nums">{b.all.toLocaleString("en-US")} mentions</span>
              {b.negative > 0 && <span className="block tabular-nums text-signal">{b.negative.toLocaleString("en-US")} negative</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[12px] text-muted-foreground/80"><span>{bars[0]!.label}</span><span>{bars[bars.length - 1]!.label}</span></div>
    </div>
  );
}

function PlatformCard({ i, name, value, share, href, active }: { i: number; name: string; value: number; share: number; href: string; active: boolean }) {
  return (
    <Link href={href} scroll={false} aria-current={active ? "true" : undefined}
      className={cn("panel lift press rise grid gap-3 rounded-[18px] p-4", active && "border-foreground/30 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]")}
      style={{ ["--d" as string]: `${180 + i * 60}ms` }}>
      <span className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
          active ? "border-transparent bg-foreground text-background" : "bg-foreground/[0.04] text-foreground")}>{i === 0 ? "∗" : name.slice(0, 1)}</span>
        <span className="truncate">{name}</span>
      </span>
      <span className="flex items-baseline justify-between gap-2">
        <CountUp value={value} className="text-[22px] font-semibold leading-none tracking-[-0.03em]" />
        <span className="text-[12px] tabular-nums text-muted-foreground">{Math.round(share * 100)}%</span>
      </span>
      <span className="block h-1 overflow-hidden rounded-full bg-foreground/[0.08]" aria-hidden>
        <span className="grow-x block h-full rounded-full bg-foreground/70" style={{ width: `${share * 100}%`, ["--d" as string]: `${400 + i * 60}ms` }} />
      </span>
    </Link>
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

function MentionItem({ i, m, canEdit, at }: { i: number; m: MentionRow; canEdit: boolean; at: (d: string) => string }) {
  const name = integrationInfo(m.source as never)?.name.replace(/ \/ Stack Exchange$/, "") ?? m.source;
  const late = new Date(m.discovered_at).getTime() - new Date(m.published_at).getTime() > 86_400_000;
  // Zero counts say nothing ("0 likes · 0 views"); only real engagement is shown.
  const engagement = Object.entries(m.engagement ?? {}).filter(([k, v]) => ENGAGEMENT_LABEL[k] && typeof v === "number" && v > 0);
  const status = STATUS_BADGE[m.relevance_status];
  const title = m.title?.trim() || null;
  const body = m.content && m.content.trim() !== title ? m.content : null;
  const category = m.feedback_category && m.feedback_category !== "general_discussion" ? categoryLabel(m.feedback_category as FeedbackCategory).replace(/s$/, "") : null;
  // Sentiment already shows as the pill; the "AI labels" row appears only when it has more to say.
  const hasLabels = Boolean(m.ai_model && (category || m.sentiment === "uncertain" || m.ai_about_product === "no"));
  const neg = m.sentiment === "negative";
  const tone = m.ai_model && m.sentiment && m.sentiment !== "uncertain" ? m.sentiment : null;

  return (
    <li className={cn("panel lift rise relative flex flex-col gap-3 overflow-hidden rounded-[18px] p-4 sm:p-5", neg && "border-signal/25")}
      style={{ ["--d" as string]: `${240 + Math.min(i, 10) * 40}ms` }}>
      {neg && <span className="pointer-events-none absolute -left-16 -top-16 size-40 rounded-full bg-signal/20 blur-3xl" aria-hidden />}
      {neg && <span className="absolute inset-y-5 left-0 w-[3px] rounded-r-full bg-signal shadow-[var(--signal-glow)]" aria-hidden />}

      <div className="relative flex items-start gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold",
          neg ? "border-signal/40 bg-signal-soft text-signal" : "bg-foreground/[0.04]")} aria-hidden>
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            <span className="font-medium">{name}</span>
            {m.mention_type !== "post" && <Badge>{MENTION_TYPES[m.mention_type] ?? m.mention_type}</Badge>}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground">
            {m.community && <span className="max-w-48 truncate">{m.community}</span>}
            {m.community && m.author_display && <span aria-hidden>·</span>}
            {m.author_display && <span className="max-w-48 truncate">{m.author_display}</span>}
            {(m.community || m.author_display) && <span aria-hidden>·</span>}
            <time dateTime={m.published_at} title={`${m.published_at_estimated ? "Found" : "Published"} ${at(m.published_at)}`}>
              {m.published_at_estimated ? "found " : ""}{formatRelative(m.published_at)}
            </time>
            {late && !m.published_at_estimated && <span title={`Discovered ${at(m.discovered_at)}`}>· found {formatRelative(m.discovered_at)}</span>}
          </span>
        </div>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {tone && (
            <span className={cn("panel flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium capitalize",
              tone === "negative" ? "text-signal" : tone === "positive" ? "text-positive" : "text-muted-foreground")}>
              <span className={cn("size-1.5 rounded-full", tone === "negative" ? "bg-signal shadow-[var(--signal-glow)]" : tone === "positive" ? "bg-positive" : "bg-muted-foreground")} aria-hidden />
              {tone}
            </span>
          )}
          {status && <Badge tone={status.tone} title={status.title} className="hidden sm:inline-flex">{status.label}</Badge>}
          {m.dedup_kind === "exact_duplicate" && <Badge title="Same text as an earlier mention; not counted as a separate report">Duplicate</Badge>}
          {m.dedup_kind === "repost" && <Badge title="Shares the same link as an earlier post">Repost</Badge>}
        </span>
      </div>

      <div className="relative grid gap-1.5 sm:pl-[52px]">
        {title && <h3 className="line-clamp-2 text-[16px] font-medium leading-snug tracking-[-0.01em]" dir="auto" lang={m.language ?? undefined}>{title}</h3>}
        {body && <ExpandableText text={body} lang={m.language} />}
        {status && <Badge tone={status.tone} title={status.title} className="w-fit sm:hidden">{status.label}</Badge>}
      </div>

      {(m.ai_model || m.matched_terms.length > 0) && (
        <div className="relative flex flex-wrap items-center gap-1.5 text-[12px] sm:pl-[52px]">
          {m.ai_model && (
            <span className={hasLabels ? "flex flex-wrap items-center gap-1" : "sr-only"} data-testid="mention-ai-labels">
              <span className="text-muted-foreground" title={m.ai_reason ?? undefined}>{m.ai_model.startsWith("test:") ? "Test labels:" : "AI labels:"}</span>
              {m.sentiment === "uncertain" && <Badge>sentiment unclear</Badge>}
              {m.sentiment && m.sentiment !== "uncertain" && <span className="sr-only">{m.sentiment} toward product</span>}
              {category && <Badge tone="info">{category}</Badge>}
              {m.ai_about_product === "no" && (
                <Badge tone="warning" title={m.ai_reason ?? undefined}>Possibly not about this product — review</Badge>
              )}
            </span>
          )}
          {m.matched_terms.length > 0 && (
            <span className="flex flex-wrap items-center gap-1 text-muted-foreground">
              <span>Matched</span>
              {m.matched_terms.map((t) => <code key={t} className="rounded-full bg-foreground/[0.06] px-2 py-0.5 font-mono text-[11px] text-foreground/80">{t}</code>)}
            </span>
          )}
        </div>
      )}

      <div className="relative mt-auto flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-foreground/[0.06] pt-3 text-[12px] text-muted-foreground sm:pl-[52px]">
        {engagement.map(([k, v]) => (
          <span key={k} className="rounded-full bg-foreground/[0.05] px-2.5 py-1 tabular">{formatCount(v)} {ENGAGEMENT_LABEL[k]![v === 1 ? 0 : 1]}</span>
        ))}
        <a
          href={m.source_url}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="press panel inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 font-medium text-foreground sm:min-h-8"
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
