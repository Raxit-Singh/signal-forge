"use client";

import { useActionState, useEffect, useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Search, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/ui/filter-select";
import { idle } from "@/lib/action-state";
import { countNewMentionsAction, setMentionRelevanceAction } from "@/app/actions/mentions";
import { useRealtime } from "@/components/realtime/realtime-provider";
import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";

type Option = { id: string; name: string };

const TABS = [
  { key: "all", label: "All", patch: { status: null, sentiment: null } },
  { key: "review", label: "Need review", patch: { status: "review", sentiment: null } },
  { key: "negative", label: "Negative", patch: { sentiment: "negative", status: null } },
  { key: "positive", label: "Positive", patch: { sentiment: "positive", status: null } },
] as const;

export function MentionFilters({ sources, types, sentiments, counts }: {
  sources: Option[]; types: Option[]; sentiments: Option[]; counts: { all: number; review: number; negative: number; positive: number };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [pending, start] = useTransition();

  // Any filter change goes back to page 1; the date range is kept. push (not replace) so Back undoes it.
  const apply = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("page");
    sp.delete("cursor");
    for (const [k, v] of Object.entries(patch)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    const qs = sp.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const hasFilters = ["q", "source", "type", "status", "dupes", "sentiment"].some((k) => params.get(k));
  const status = params.get("status") ?? "";
  const sentiment = params.get("sentiment") ?? "";
  const tab = status === "review" && !sentiment ? "review"
    : !status && sentiment === "negative" ? "negative"
    : !status && sentiment === "positive" ? "positive"
    : !status && !sentiment ? "all" : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Show" className="panel flex max-w-full overflow-x-auto rounded-full p-1 text-[13px]">
          {TABS.map((t) => {
            const on = tab === t.key;
            const n = counts[t.key];
            return (
              <button key={t.key} type="button" role="radio" aria-checked={on} onClick={() => apply({ ...t.patch })}
                className={cn("press flex h-8 shrink-0 items-center gap-2 rounded-full px-3.5 transition-colors duration-200",
                  on ? "bg-foreground/[0.09] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "text-muted-foreground hover:text-foreground")}>
                {t.key === "negative" && <span className="size-1.5 rounded-full bg-signal shadow-[var(--signal-glow)]" aria-hidden />}
                {t.label}
                <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", on ? "bg-foreground/[0.1]" : "bg-foreground/[0.05]")}>{n > 9999 ? "9999+" : n.toLocaleString("en-US")}</span>
              </button>
            );
          })}
        </div>
        <form
          role="search"
          aria-label="Filter mentions"
          className="panel flex h-10 w-full items-center gap-2 rounded-full pl-3.5 pr-1 sm:w-[340px]"
          onSubmit={(e) => {
            e.preventDefault();
            apply({ q: q.trim() || null });
          }}
        >
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <label className="sr-only" htmlFor="mention-q">Search text</label>
          <input
            id="mention-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search text…"
            maxLength={100}
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-[13px]"
          />
          <Button type="submit" size="sm" className="h-8 rounded-full px-3.5">Search</Button>
        </form>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Platform" value={params.get("source") ?? ""} onChange={(v) => apply({ source: v || null })}
          options={[{ value: "", label: "All platforms" }, ...sources.map((o) => ({ value: o.id, label: o.name, icon: <BrandLogo source={o.id} variant="brand" size={14} /> }))]} />
        <FilterSelect label="Type" value={params.get("type") ?? ""} onChange={(v) => apply({ type: v || null })}
          options={[{ value: "", label: "All types" }, ...types.map((o) => ({ value: o.id, label: o.name }))]} />
        <FilterSelect label="Sentiment" value={sentiment} onChange={(v) => apply({ sentiment: v || null })}
          options={[{ value: "", label: "Any sentiment" }, ...sentiments.map((o) => ({ value: o.id, label: o.name }))]} />
        <FilterSelect label="Relevance" value={status} onChange={(v) => apply({ status: v || null })}
          options={[
            { value: "", label: "Relevant + needs review" }, { value: "review", label: "Needs review" },
            { value: "relevant", label: "Relevant only" }, { value: "irrelevant", label: "Not relevant" }, { value: "all", label: "Everything" },
          ]} />
        <label className="flex min-h-9 cursor-pointer items-center gap-1.5 px-1 text-[13px] text-muted-foreground">
          <input
            type="checkbox"
            className="size-3.5 accent-[var(--primary)]"
            checked={params.get("dupes") === "1"}
            onChange={(e) => apply({ dupes: e.target.checked ? "1" : null })}
          />
          Duplicates &amp; reposts
        </label>
        {hasFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 rounded-full"
            onClick={() => {
              setQ("");
              apply({ q: null, source: null, type: null, status: null, dupes: null, sentiment: null });
            }}
          >
            <X aria-hidden /> Clear
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Content preview clamped to four lines with Read more / Show less. Only the
 * display is clamped; the full stored text is in the DOM, in its original language.
 */
export function ExpandableText({ text, lang }: { text: string; lang: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight - el.clientHeight > 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="grid justify-items-start gap-0.5">
      <p
        ref={ref}
        dir="auto"
        lang={lang ?? undefined}
        className={cn("whitespace-pre-line break-words text-[13px] leading-relaxed text-muted-foreground", !expanded && "line-clamp-4")}
      >
        {text}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="min-h-9 text-xs font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring sm:min-h-0"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

type Decision = "user_relevant" | "user_irrelevant" | null;

/** Relevant / Not relevant toggle. Optimistic: the server confirms and RLS has the final word. */
export function RelevanceButtons({ mentionId, status }: { mentionId: string; status: string }) {
  const current: Decision = status === "user_relevant" || status === "user_irrelevant" ? status : null;
  const [optimistic, setOptimistic] = useOptimistic<Decision, Decision>(current, (_, next) => next);
  const [state, action, pending] = useActionState(setMentionRelevanceAction, idle);

  const send = (value: "relevant" | "irrelevant" | "reset", next: Decision) => {
    const fd = new FormData();
    fd.set("mentionId", mentionId);
    fd.set("value", value);
    setOptimistic(next);
    action(fd);
  };

  const relevant = optimistic === "user_relevant";
  const irrelevant = optimistic === "user_irrelevant";
  const base = "h-9 gap-1 px-2.5 text-xs sm:h-7";

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Mark relevance">
      <form action={() => send(relevant ? "reset" : "relevant", relevant ? null : "user_relevant")}>
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          aria-pressed={relevant}
          aria-label="Relevant"
          title={relevant ? "Marked relevant. Click to undo." : "Mark as relevant"}
          className={cn(base, "border", relevant ? "border-positive/40 bg-positive/12 text-positive hover:bg-positive/16" : "border-transparent text-muted-foreground")}
          disabled={pending}
        >
          {relevant ? <Check aria-hidden /> : <ThumbsUp aria-hidden />}
          Relevant
        </Button>
      </form>
      <form action={() => send(irrelevant ? "reset" : "irrelevant", irrelevant ? null : "user_irrelevant")}>
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          aria-pressed={irrelevant}
          aria-label="Not relevant"
          title={irrelevant ? "Marked not relevant. Click to undo." : "Mark as not relevant"}
          className={cn(base, "border", irrelevant ? "border-negative/40 bg-negative/12 text-negative hover:bg-negative/16" : "border-transparent text-muted-foreground")}
          disabled={pending}
        >
          {irrelevant ? <Check aria-hidden /> : <ThumbsDown aria-hidden />}
          Not relevant
        </Button>
      </form>
      {state.status === "error" && <span role="alert" className="text-xs text-negative">{state.message}</span>}
    </div>
  );
}

/**
 * On page 1 new mentions simply appear (the page refreshes in place, scroll kept).
 * On older pages the content stays put; a notice offers the newest page instead,
 * keeping filters, search and date range.
 */
export function NewMentionsNotice({ productId, page, loadedAt }: { productId: string; page: number; loadedAt: string }) {
  const rt = useRealtime();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [count, setCount] = useState(0);
  const [, start] = useTransition();

  useEffect(() => {
    if (!rt || page <= 1) return;
    rt.hold("mentions-page", true);
    const off = rt.subscribe((e) => {
      if (e.kind !== "mentions" && e.kind !== "resync") return;
      void countNewMentionsAction(productId, loadedAt).then(setCount);
    });
    return () => {
      off();
      rt.hold("mentions-page", false);
    };
  }, [rt, page, productId, loadedAt]);

  if (page <= 1 || count === 0) return null;
  const latest = () => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("page");
    const qs = sp.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };
  return (
    <div role="status" className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-info/30 bg-info/8 px-3 py-2 text-[13px]" data-testid="new-mentions-notice">
      <span>{count.toLocaleString("en-US")} new mention{count === 1 ? "" : "s"} found</span>
      <Button type="button" size="sm" variant="secondary" onClick={latest}>View latest</Button>
    </div>
  );
}
