import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SourceError } from "@/lib/sources/errors";
import type { PublicSourceId, RateLimitPolicy, SourceContext, SourceRequest } from "@/lib/sources/types";

export interface UsageEvent {
  provider: PublicSourceId;
  endpoint: string;
  units: number;
  status_code: number | null;
}

/** Who a paid request is for: its cost is split across these products' budgets. */
export interface BillingMember {
  workspace_id: string;
  product_id: string;
  boost_id?: string | null;
}

export interface BillingScope {
  members: BillingMember[];
  jobId: string | null;
  fingerprint: string | null;
}

export interface PaidCall {
  ledgerId: string;
  pricingKey: string;
  purpose: string;
}

/** Longest the worker will sleep in-process for a token before deferring the job instead. */
const MAX_INLINE_WAIT_MS = 4000;
const REQUEST_TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const REFUSALS: Record<string, string> = {
  no_global_budget: "Paid collection is paused: no global spending limit is configured.",
  global_budget_exhausted: "Paid collection is paused: the global monthly spending limit is reached.",
  provider_budget_exhausted: "Paid collection is paused: the provider's monthly spending limit is reached.",
  platform_budget_exhausted: "Paid collection is paused: this platform's monthly spending limit is reached.",
  workspace_budget_exhausted: "This workspace's paid-source allowance for the month is used up (or not included in its plan).",
  unpriced: "This paid endpoint has no price in the pricing registry.",
};

function secondsToNextMonth(now = new Date()) {
  return Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - now.getTime()) / 1000);
}

/**
 * HTTP access for adapters: every call takes tokens from the shared Postgres
 * bucket first, has a timeout, and is recorded for cost/quota accounting.
 * Paid calls additionally reserve budget atomically before the request and are
 * settled with the provider's billing outcome afterwards.
 * URLs and headers are never logged — some carry API keys.
 */
export function createSourceContext(
  admin: SupabaseClient,
  provider: PublicSourceId,
  policyFor: (endpoint?: string) => RateLimitPolicy,
  usage: UsageEvent[],
  billing?: BillingScope,
  paidCalls: PaidCall[] = [],
): SourceContext {
  async function take(req: SourceRequest) {
    const cost = req.cost ?? 1;
    const policy = policyFor(req.endpoint);
    for (let attempt = 0; ; attempt++) {
      const { data, error } = await admin.rpc("svc_take_tokens", {
        p_key: policy.key, p_cost: cost, p_capacity: policy.capacity, p_refill_per_sec: policy.refillPerSecond,
      });
      if (error) throw new SourceError("transient", "Rate limiter unavailable");
      const wait = Number(data);
      if (wait <= 0) return;
      if (wait * 1000 > MAX_INLINE_WAIT_MS || attempt >= 2) {
        throw new SourceError("rate_limited", `Waiting for ${provider} rate limit`, { retryAfterSeconds: Math.ceil(wait) + 1 });
      }
      await sleep(wait * 1000 + 50);
    }
  }

  async function send(req: SourceRequest): Promise<Response> {
    const cost = req.cost ?? 1;
    const signals = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)];
    if (req.signal) signals.push(req.signal);
    try {
      const res = await fetch(req.url, { method: req.method ?? "GET", body: req.body, headers: req.headers, signal: AbortSignal.any(signals), cache: "no-store" });
      usage.push({ provider, endpoint: req.endpoint, units: cost, status_code: res.status });
      return res;
    } catch (e) {
      usage.push({ provider, endpoint: req.endpoint, units: cost, status_code: null });
      const name = e instanceof Error ? e.name : "Error";
      throw new SourceError("transient", `${provider}: network error (${name === "TimeoutError" ? "timeout" : name})`);
    }
  }

  return {
    async request(req) {
      if (req.billing) throw new SourceError("bad_request", "Paid requests must use paidRequest()");
      await take(req);
      return send(req);
    },

    async paidRequest(req) {
      if (!billing || billing.members.length === 0) {
        throw new SourceError("budget", "Paid request without a billing scope");
      }
      await take(req);
      const { data, error } = await admin.rpc("svc_reserve_api_spend", {
        p_platform: provider,
        p_pricing_key: req.billing.pricingKey,
        p_units: req.billing.units,
        p_purpose: req.billing.purpose,
        p_members: billing.members,
        p_job_id: billing.jobId,
        p_fingerprint: billing.fingerprint,
      });
      if (error) throw new SourceError("transient", "Budget service unavailable");
      const r = data as { ok: boolean; reason?: string; ledger_id?: string };
      if (!r.ok || !r.ledger_id) {
        const reason = r.reason ?? "refused";
        throw new SourceError("budget", REFUSALS[reason] ?? `Paid request refused (${reason})`, {
          retryAfterSeconds: reason === "unpriced" || reason === "no_global_budget" ? 6 * 3600 : Math.min(secondsToNextMonth(), 26 * 3600),
        });
      }
      const ledgerId = r.ledger_id;
      paidCalls.push({ ledgerId, pricingKey: req.billing.pricingKey, purpose: req.billing.purpose });
      const started = Date.now();
      let settled = false;
      const settle = async (o: { billedUnits: number; errorCode?: string | null; results?: number | null }, status: number | null) => {
        if (settled) return;
        settled = true;
        await admin.rpc("svc_settle_api_spend", {
          p_ledger_id: ledgerId, p_http_status: status, p_error_code: o.errorCode ?? null,
          p_billed_units: o.billedUnits, p_results: o.results ?? null, p_duration_ms: Date.now() - started,
        });
      };
      let res: Response;
      try {
        res = await send(req);
      } catch (e) {
        // No answer seen: it may still have been billed, so it stays counted at its estimate.
        await settle({ billedUnits: 0, errorCode: "no_response" }, null);
        throw e;
      }
      return { response: res, ledgerId, settle: (o) => settle(o, res.status) };
    },

    async cooldown(seconds, endpoint) {
      if (!(seconds > 0)) return;
      const policy = policyFor(endpoint);
      await admin.rpc("svc_drain_tokens", {
        p_key: policy.key, p_seconds_until_refill: seconds, p_refill_per_sec: policy.refillPerSecond,
      });
    },

    now: () => new Date(),
  };
}
