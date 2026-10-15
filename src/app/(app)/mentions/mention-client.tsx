"use client";

import { useActionState, useOptimistic, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ThumbsDown, ThumbsUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { idle } from "@/lib/action-state";
import { setMentionRelevanceAction } from "@/app/actions/mentions";
import { cn } from "@/lib/utils";

const selectCls =
  "h-8 rounded-md border bg-background px-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

export function MentionFilters({ sources }: { sources: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [pending, start] = useTransition();

  // Any filter change restarts pagination; the date range is kept.
  const apply = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("cursor");
    for (const [k, v] of Object.entries(patch)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    start(() => router.replace(`${pathname}?${sp.toString()}`, { scroll: false }));
  };

  const hasFilters = ["q", "source", "status", "dupes"].some((k) => params.get(k));

  return (
    <form
      role="search"
      aria-label="Filter mentions"
      aria-busy={pending}
      className="mb-4 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply({ q: q.trim() || null });
      }}
    >
      <label className="sr-only" htmlFor="mention-q">Search text</label>
      <Input
        id="mention-q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search text…"
        maxLength={100}
        className="h-8 w-full sm:w-56"
      />
      <label className="sr-only" htmlFor="mention-source">Source</label>
      <select id="mention-source" className={selectCls} value={params.get("source") ?? ""} onChange={(e) => apply({ source: e.target.value || null })}>
        <option value="">All sources</option>
        {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <label className="sr-only" htmlFor="mention-status">Relevance</label>
      <select id="mention-status" className={selectCls} value={params.get("status") ?? ""} onChange={(e) => apply({ status: e.target.value || null })}>
        <option value="">Relevant + needs review</option>
        <option value="review">Needs review</option>
        <option value="relevant">Relevant only</option>
        <option value="irrelevant">Marked not relevant</option>
        <option value="all">Everything</option>
      </select>
      <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <input
          type="checkbox"
          className="size-3.5 accent-[var(--primary)]"
          checked={params.get("dupes") === "1"}
          onChange={(e) => apply({ dupes: e.target.checked ? "1" : null })}
        />
        Show duplicates &amp; reposts
      </label>
      <Button type="submit" variant="secondary" size="sm">Search</Button>
      {hasFilters && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            apply({ q: null, source: null, status: null, dupes: null });
          }}
        >
          <X aria-hidden /> Clear
        </Button>
      )}
    </form>
  );
}

type Decision = "user_relevant" | "user_irrelevant" | null;

/** Relevant / not relevant toggle. Optimistic: the server confirms and RLS has the final word. */
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

  return (
    <div className="flex items-center gap-1">
      <form action={() => send(optimistic === "user_relevant" ? "reset" : "relevant", optimistic === "user_relevant" ? null : "user_relevant")}>
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          aria-pressed={optimistic === "user_relevant"}
          aria-label="Relevant"
          title="Relevant"
          className={cn(optimistic === "user_relevant" && "bg-positive/12 text-positive")}
          disabled={pending}
        >
          <ThumbsUp />
        </Button>
      </form>
      <form action={() => send(optimistic === "user_irrelevant" ? "reset" : "irrelevant", optimistic === "user_irrelevant" ? null : "user_irrelevant")}>
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          aria-pressed={optimistic === "user_irrelevant"}
          aria-label="Not relevant"
          title="Not relevant"
          className={cn(optimistic === "user_irrelevant" && "bg-negative/12 text-negative")}
          disabled={pending}
        >
          <ThumbsDown />
        </Button>
      </form>
      {state.status === "error" && <span role="alert" className="text-xs text-negative">{state.message}</span>}
    </div>
  );
}
