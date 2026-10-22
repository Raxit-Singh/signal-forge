// TikHub keyword search for X, TikTok and Instagram (paid, per successful
// request). It replaces the API Direct *search* of a platform listed in
// TIKHUB_PLATFORMS; everything else about that platform (comment expansion,
// stream ids and checkpoints) stays on the API Direct adapter, so switching a
// platform back is just removing it from the list.
//
// Reddit is not offered: TikHub's only Reddit search endpoint failed for every
// query in the live check of 2026-10-22.

import { SourceError } from "../errors.ts";
import type { CandidateMention, PaidSourceId, SearchRequest, SearchResult, SourceAdapter } from "../types.ts";
import { TIKHUB_ENDPOINTS, tikhubGet } from "./client.ts";
import {
  instagramMediaIn, normalizeTikhubInstagram, normalizeTikhubTiktok, normalizeTikhubTweet,
  type TikhubTiktokItem, type TikhubTweet,
} from "./normalizers.ts";

export const TIKHUB_CAPABLE: readonly PaidSourceId[] = ["x", "tiktok", "instagram"];

const DAY = 86_400_000;

/** Platforms to search through TikHub, from a comma-separated setting (unknown names ignored). */
export function tikhubPlatforms(setting: string | undefined): PaidSourceId[] {
  return (setting ?? "").split(",").map((s) => s.trim().toLowerCase())
    .filter((s): s is PaidSourceId => (TIKHUB_CAPABLE as readonly string[]).includes(s));
}

function inWindow(items: CandidateMention[], req: SearchRequest): CandidateMention[] {
  return items.filter((i) => i.publishedAt >= req.window.since && i.publishedAt <= req.window.until);
}

function tag(items: CandidateMention[], ledgerId: string | null): CandidateMention[] {
  for (const i of items) i.originRequestId = ledgerId;
  return items;
}

const pagesOf = (req: SearchRequest, cap: number) => Math.max(1, Math.min(cap, Math.floor(req.maxPages)));

function keyword(req: SearchRequest): string {
  const q = (req.query ?? req.terms[0] ?? "").trim();
  if (!q) throw new SourceError("bad_request", "Empty query");
  return q.slice(0, 300);
}

/** X search query with the window as search operators (TikHub has no date parameters; operators work). */
export function xQuery(req: SearchRequest): string {
  const q = (req.query ?? req.terms.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(" OR ")).trim();
  if (!q) throw new SourceError("bad_request", "Empty query");
  const since = req.window.since.toISOString().slice(0, 10);
  // `until:` is exclusive: the day after the window's end.
  const until = new Date(req.window.until.getTime() + DAY).toISOString().slice(0, 10);
  return `${q.slice(0, 400)} since:${since} until:${until}`;
}

/** TikTok's publish-time filter: the smallest preset (days) covering the window; 0 = any time. */
export function tiktokPublishTime(windowMs: number): string {
  for (const d of [1, 7, 30, 90, 180]) if (windowMs <= d * DAY) return String(d);
  return "0";
}

export function createTikhubSearch(apiKey: string): Partial<Record<PaidSourceId, SourceAdapter["searchMentions"]>> {
  return {
    async x(req, ctx) {
      const max = pagesOf(req, 10);
      const items = new Map<string, CandidateMention>();
      let cursor: string | undefined;
      let pages = 0;
      let exhausted = false;
      while (pages < max) {
        const params: Record<string, string> = { keyword: xQuery(req), search_type: "Latest" };
        if (cursor) params.cursor = cursor;
        const r = await tikhubGet<{ timeline?: TikhubTweet[]; next_cursor?: string }>(ctx, apiKey, TIKHUB_ENDPOINTS.xSearch, params, "search",
          (d) => (Array.isArray(d.timeline) ? d.timeline.length : null), req.signal);
        pages++;
        const before = items.size;
        for (const m of tag(r.data.timeline!.map(normalizeTikhubTweet).filter((x): x is CandidateMention => x !== null), r.ledgerId)) items.set(m.externalId, m);
        cursor = r.data.next_cursor || undefined;
        if (!cursor || items.size === before) {
          exhausted = true;
          break;
        }
      }
      return {
        items: inWindow([...items.values()], req), complete: exhausted, saturated: !exhausted, pagesRequested: pages,
        incompleteReason: exhausted ? undefined : `X search had more than ${pages} pages in this window; the rest is collected next time.`,
      };
    },

    async tiktok(req, ctx) {
      const max = pagesOf(req, 10);
      const items = new Map<string, CandidateMention>();
      let offset = 0;
      let pages = 0;
      let more = true;
      const publishTime = tiktokPublishTime(req.window.until.getTime() - req.window.since.getTime());
      while (pages < max && more) {
        const r = await tikhubGet<{ search_item_list?: TikhubTiktokItem[]; has_more?: number; cursor?: number }>(ctx, apiKey, TIKHUB_ENDPOINTS.tiktokSearch,
          { keyword: keyword(req), count: "20", offset: String(offset), sort_type: "0", publish_time: publishTime, region: "US" }, "search",
          (d) => (Array.isArray(d.search_item_list) ? d.search_item_list.length : d.has_more === 0 ? 0 : null), req.signal);
        pages++;
        for (const m of tag((r.data.search_item_list ?? []).map(normalizeTikhubTiktok).filter((x): x is CandidateMention => x !== null), r.ledgerId)) items.set(m.externalId, m);
        more = r.data.has_more === 1 && typeof r.data.cursor === "number" && r.data.cursor > offset;
        offset = r.data.cursor ?? offset + 20;
      }
      return {
        items: inWindow([...items.values()], req), complete: !more, saturated: more, pagesRequested: pages,
        incompleteReason: more ? "TikTok search is ranked by relevance; more results in this window may exist beyond the pages read." : undefined,
      };
    },

    async instagram(req, ctx) {
      const max = pagesOf(req, 2);
      const items = new Map<string, CandidateMention>();
      let token: string | undefined;
      let pages = 0;
      while (pages < max) {
        const params: Record<string, string> = { keyword: keyword(req) };
        if (token) params.pagination_token = token;
        const r = await tikhubGet<{ data?: unknown; pagination_token?: string }>(ctx, apiKey, TIKHUB_ENDPOINTS.instagramReels, params, "search",
          (d) => instagramMediaIn(d).length, req.signal);
        pages++;
        for (const m of tag(instagramMediaIn(r.data).map(normalizeTikhubInstagram).filter((x): x is CandidateMention => x !== null), r.ledgerId)) items.set(m.externalId, m);
        token = r.data.pagination_token || undefined;
        if (!token) break;
      }
      return {
        items: inWindow([...items.values()], req), complete: false, saturated: false, pagesRequested: pages,
        incompleteReason: "Instagram search is ranked by relevance with no date filter, so it can't guarantee every result in this window.",
      };
    },
  };
}

/**
 * The API Direct adapters with TikHub search on the chosen platforms. The
 * adapter keeps its id, streams and comment expansion; only search changes.
 */
export function withTikhubSearch(
  adapters: Record<PaidSourceId, SourceAdapter>,
  apiKey: string | undefined,
  platforms: readonly PaidSourceId[],
): Record<PaidSourceId, SourceAdapter> {
  if (!apiKey || platforms.length === 0) return adapters;
  const search = createTikhubSearch(apiKey);
  const out = { ...adapters };
  for (const id of platforms) {
    const fn = search[id];
    const base = adapters[id];
    if (!fn || !base) continue;
    out[id] = {
      ...base,
      dataProvider: "tikhub",
      // TikHub allows 10 requests per second per endpoint; stay well below.
      rateLimit: () => ({ key: `tikhub:${id}`, capacity: 6, refillPerSecond: 3 }),
      configured: () => ({ ok: true }),
      searchMentions: (req, ctx) => fn(req, ctx) as Promise<SearchResult>,
      streams: id === "tiktok"
        // TikHub's TikTok search can't sort by date (relevance + publish-time filter).
        ? base.streams?.map((s) => ({ ...s, capabilities: { ...s.capabilities, sortNewest: false } }))
        : base.streams,
    };
  }
  return out;
}
