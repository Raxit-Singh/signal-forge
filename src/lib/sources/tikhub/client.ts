// Centralized TikHub client (paid). Every call:
//   1. reserves budget through the context (paid calls never bypass budgets)
//   2. sends `Authorization: Bearer` (server-side only; never logged, never in URLs)
//   3. settles the reservation: TikHub bills per successful request (one unit);
//      failed requests say "You won't be charged" and settle at zero
//   4. maps errors to SourceError and retries TikHub's generic upstream failure
//      (HTTP 400 "Request failed. Please retry") once, as its docs advise
//
// Live checks (2026-10-22): a successful call cost exactly the listed price
// ($0.001; Instagram v2 $0.002), and failed calls left the balance unchanged.

import { SourceError } from "../errors.ts";
import type { SourceContext, SpendPurpose } from "../types.ts";

export const TIKHUB_BASE = "https://api.tikhub.io";
const MAX_TRIES = 2;

export interface TikhubEndpoint {
  /** Key in the `provider_pricing` registry. */
  pricingKey: string;
  path: string;
}

export const TIKHUB_ENDPOINTS = {
  xSearch: { pricingKey: "tikhub_x.search", path: "/api/v1/twitter/web/fetch_search_timeline" },
  tiktokSearch: { pricingKey: "tikhub_tiktok.search", path: "/api/v1/tiktok/app/v3/fetch_video_search_result" },
  instagramReels: { pricingKey: "tikhub_instagram.reels", path: "/api/v1/instagram/v2/search_reels" },
} as const satisfies Record<string, TikhubEndpoint>;

interface TikhubErrorBody {
  detail?: { code?: number; message?: string } | string;
  code?: number;
  message?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function messageOf(body: TikhubErrorBody | null): string {
  if (!body) return "";
  if (typeof body.detail === "string") return body.detail;
  return body.detail?.message ?? body.message ?? "";
}

/** Maps a TikHub error response to a SourceError. */
export function tikhubError(status: number, body: TikhubErrorBody | null): SourceError {
  const msg = messageOf(body).slice(0, 200);
  if (status === 401 || status === 403) return new SourceError("auth", `TikHub ${status}: API key rejected or missing scope`, { status });
  if (status === 402 || /insufficient|balance|余额/i.test(msg)) {
    return new SourceError("budget", "TikHub: account balance used up", { status, retryAfterSeconds: 6 * 3600 });
  }
  if (status === 429) return new SourceError("rate_limited", "TikHub 429", { status, retryAfterSeconds: 30 });
  // TikHub's generic upstream failure ("Request failed. Please retry ... You won't be charged").
  if (status === 400 && /retry/i.test(msg)) return new SourceError("transient", "TikHub: the platform request failed", { status, retryAfterSeconds: 120 });
  if (status === 400 || status === 404 || status === 422) return new SourceError("bad_request", `TikHub ${status}: ${msg || "invalid request"}`, { status });
  if (status >= 500) return new SourceError("transient", `TikHub ${status}`, { status, retryAfterSeconds: 60 });
  return new SourceError("bad_request", `TikHub ${status}`, { status });
}

export interface TikhubResult<T> {
  data: T;
  /** Ledger row of the successful request, for attributing results to it. */
  ledgerId: string | null;
}

/**
 * One paid GET. `count` reports how many items came back (for the ledger).
 * Retries are new requests: each reserves and settles on its own.
 */
export async function tikhubGet<T>(
  ctx: SourceContext,
  apiKey: string,
  endpoint: TikhubEndpoint,
  params: Record<string, string>,
  purpose: SpendPurpose,
  count: (data: T) => number | null,
  signal?: AbortSignal,
): Promise<TikhubResult<T>> {
  const url = `${TIKHUB_BASE}${endpoint.path}?${new URLSearchParams(params)}`;
  for (let attempt = 1; ; attempt++) {
    const paid = await ctx.paidRequest({
      url,
      endpoint: endpoint.path,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal,
      billing: { pricingKey: endpoint.pricingKey, units: 1, purpose },
    });
    const res = paid.response;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const b = (body && typeof body === "object" ? body : null) as (TikhubErrorBody & { data?: unknown }) | null;
    if (res.ok && b && b.code === 200 && b.data !== undefined && b.data !== null) {
      const data = b.data as T;
      let n: number | null = null;
      try {
        n = count(data);
      } catch {
        n = null;
      }
      await paid.settle({ billedUnits: 1, results: n });
      if (n === null) throw new SourceError("bad_request", `TikHub ${endpoint.path}: unexpected response shape`, { status: res.status });
      return { data, ledgerId: paid.ledgerId };
    }
    // TikHub doesn't charge failed requests.
    await paid.settle({ billedUnits: 0, errorCode: String(b?.code ?? res.status), results: null });
    const err = tikhubError(res.ok ? 502 : res.status, b);
    if (err.kind === "budget") await ctx.cooldown(err.retryAfterSeconds ?? 3600, endpoint.path);
    if (attempt < MAX_TRIES && err.kind === "transient") {
      await sleep(1500);
      continue;
    }
    throw err;
  }
}
