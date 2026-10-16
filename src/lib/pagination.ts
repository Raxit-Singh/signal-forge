// Numbered pagination helpers (pure).

export type PageItem = number | "ellipsis-start" | "ellipsis-end";

/** 1-based page from a URL param; anything invalid is page 1. */
export function parsePage(value: string | undefined | null): number {
  if (!value || !/^\d{1,6}$/.test(value)) return 1;
  return Math.max(1, Number(value));
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

/** "Showing 21–40 of 292": 1-based inclusive range of the rows on `page` (0–0 when empty). */
export function pageRange(page: number, pageSize: number, total: number): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  return { from: Math.min(from, total), to: Math.min(page * pageSize, total) };
}

/**
 * Page links to show: always the first and last page, `siblings` pages either
 * side of the current one, and an ellipsis for each gap of 2+ pages.
 *   pageItems(1, 18)  → 1 2 3 4 5 … 18
 *   pageItems(9, 18)  → 1 … 8 9 10 … 18
 */
export function pageItems(current: number, total: number, siblings = 1): PageItem[] {
  if (total <= 1) return [1];
  const slots = 2 * siblings + 5; // first, last, current, siblings, two ellipses
  if (total <= slots) return Array.from({ length: total }, (_, i) => i + 1);
  const page = Math.min(Math.max(1, current), total);
  const left = Math.max(page - siblings, 2);
  const right = Math.min(page + siblings, total - 1);
  const showLeft = left > 3;
  const showRight = right < total - 2;
  if (!showLeft && showRight) {
    const count = 3 + 2 * siblings;
    return [...Array.from({ length: count }, (_, i) => i + 1), "ellipsis-end", total];
  }
  if (showLeft && !showRight) {
    const count = 3 + 2 * siblings;
    return [1, "ellipsis-start", ...Array.from({ length: count }, (_, i) => total - count + 1 + i)];
  }
  // Both gaps (the case without either can't happen once total > slots).
  const middle = Array.from({ length: right - left + 1 }, (_, i) => left + i);
  return [1, "ellipsis-start", ...middle, "ellipsis-end", total];
}

/** Same URL with `page` set (dropped for page 1), every other parameter kept. */
export function pageHref(pathname: string, params: Record<string, string | undefined>, page: number): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && k !== "page" && k !== "cursor") sp.set(k, v);
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
