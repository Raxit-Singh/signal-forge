// Centralized API Direct client. Every call:
//   1. validates parameters against the documented endpoint spec
//   2. reserves budget through the context (paid calls never bypass budgets)
//   3. sends `X-API-Key` (server-side only; never logged, never in URLs)
//   4. settles the reservation with the provider's documented billing outcome
//   5. maps errors to SourceError and retries transient failures (max 3 tries,
//      exponential backoff), as API Direct's error-handling guide recommends
//   6. validates the response shape before anything is normalized

import type { z } from "zod";
import { SourceError, secondsUntilUtcMidnight } from "../errors.ts";
import type { SourceContext, SpendPurpose } from "../types.ts";
import { billedUnits, unitsRequested, validateParams, type EndpointSpec, type Params } from "./endpoints.ts";

export const API_DIRECT_BASE = "https://apidirect.io";
const MAX_TRIES = 3;

export interface ApiDirectError {
  error?: string;
  code?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seconds until the first day of next month (UTC), when monthly spending limits reset. */
export function secondsUntilNextMonthUtc(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.ceil((next - now.getTime()) / 1000);
}

/** Maps an API Direct error response (docs: Error Handling) to a SourceError. */
export function apiDirectError(status: number, body: ApiDirectError, now: Date): SourceError {
  const code = body.code ?? "";
  const label = `API Direct ${code || status}`;
  switch (code) {
    case "missing_api_key":
    case "invalid_api_key":
    case "user_not_found":
    case "account_blocked":
    case "upstream_auth_error":
      return new SourceError(code === "upstream_auth_error" ? "transient" : "auth", `${label}: ${status}`, { status, retryAfterSeconds: code === "upstream_auth_error" ? 60 : undefined });
    case "payment_required":
      return new SourceError("budget", "API Direct: free tier used up and no payment method on the account", { status, retryAfterSeconds: 6 * 3600 });
    case "daily_limit_exceeded":
      return new SourceError("budget", "API Direct: account daily spending limit reached", { status, retryAfterSeconds: secondsUntilUtcMidnight(now) + 60 });
    case "monthly_limit_exceeded":
      return new SourceError("budget", "API Direct: account monthly spending limit reached", { status, retryAfterSeconds: Math.min(secondsUntilNextMonthUtc(now) + 60, 26 * 3600) });
    case "concurrency_limit_exceeded":
    case "upstream_rate_limit":
      return new SourceError("rate_limited", `${label}`, { status, retryAfterSeconds: 30 });
    case "missing_parameter":
    case "invalid_parameter":
      return new SourceError("bad_request", `${label}: ${body.error ?? "invalid request"}`.slice(0, 300), { status });
  }
  if (status === 404) return new SourceError("bad_request", `${label}: not found`, { status });
  if (status === 429) return new SourceError("rate_limited", label, { status, retryAfterSeconds: 30 });
  if (status === 401 || status === 403) return new SourceError("auth", label, { status });
  if (status >= 500) return new SourceError("transient", label, { status, retryAfterSeconds: 60 });
  return new SourceError("bad_request", label, { status });
}

function isRetryable(e: SourceError): boolean {
  return e.kind === "transient" || (e.kind === "rate_limited" && e.status === 429);
}

export interface ApiDirectResult<T> {
  body: T;
  /** Ledger row of the successful request, for attributing results to it. */
  ledgerId: string | null;
  units: number;
}

/**
 * One paid GET. Retries are new requests: each one reserves and settles on its
 * own, so a retried failure that the provider didn't bill costs nothing.
 */
export async function apiDirectGet<S extends z.ZodType>(
  ctx: SourceContext,
  apiKey: string,
  spec: EndpointSpec,
  params: Params,
  schema: S,
  purpose: SpendPurpose,
  signal?: AbortSignal,
): Promise<ApiDirectResult<z.output<S>>> {
  let qs: URLSearchParams;
  try {
    qs = validateParams(spec, params);
  } catch (e) {
    throw new SourceError("bad_request", e instanceof Error ? e.message : "invalid parameters");
  }
  const units = unitsRequested(spec, params);
  const url = `${API_DIRECT_BASE}${spec.path}?${qs}`;

  for (let attempt = 1; ; attempt++) {
    const paid = await ctx.paidRequest({
      url,
      endpoint: spec.path,
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      signal,
      billing: { pricingKey: spec.pricingKey, units, purpose },
    });
    const res = paid.response;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const errBody = (body && typeof body === "object" ? body : {}) as ApiDirectError;
    const billed = billedUnits(spec, res.status, errBody.code, units);

    if (res.ok) {
      const parsed = schema.safeParse(body);
      const list = parsed.success ? (parsed.data as Record<string, unknown>)[spec.listField] : null;
      await paid.settle({ billedUnits: billed, results: Array.isArray(list) ? list.length : null });
      if (!parsed.success) {
        // Answered (and billed) but not in the documented shape: stop rather than guess.
        throw new SourceError("bad_request", `API Direct ${spec.path}: unexpected response shape`, { status: res.status });
      }
      return { body: parsed.data, ledgerId: paid.ledgerId, units };
    }

    await paid.settle({ billedUnits: billed, errorCode: errBody.code ?? null, results: null });
    const err = apiDirectError(res.status, errBody, ctx.now());
    if (err.kind === "budget") {
      await ctx.cooldown(err.retryAfterSeconds ?? 3600, spec.path);
    }
    if (attempt < MAX_TRIES && isRetryable(err)) {
      await sleep(1000 * 2 ** (attempt - 1));
      continue;
    }
    throw err;
  }
}
