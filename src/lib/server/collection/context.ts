import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SourceError } from "@/lib/sources/errors";
import type { PublicSourceId, RateLimitPolicy, SourceContext } from "@/lib/sources/types";

export interface UsageEvent {
  provider: PublicSourceId;
  endpoint: string;
  units: number;
  status_code: number | null;
}

/** Longest the worker will sleep in-process for a token before deferring the job instead. */
const MAX_INLINE_WAIT_MS = 4000;
const REQUEST_TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * HTTP access for adapters: every call takes tokens from the shared Postgres
 * bucket first, has a timeout, and is recorded for cost/quota accounting.
 * URLs are never logged — some carry API keys in the query string.
 */
export function createSourceContext(
  admin: SupabaseClient,
  provider: PublicSourceId,
  policyFor: (endpoint?: string) => RateLimitPolicy,
  usage: UsageEvent[],
): SourceContext {
  return {
    async request(req) {
      const cost = req.cost ?? 1;
      const policy = policyFor(req.endpoint);
      for (let attempt = 0; ; attempt++) {
        const { data, error } = await admin.rpc("svc_take_tokens", {
          p_key: policy.key, p_cost: cost, p_capacity: policy.capacity, p_refill_per_sec: policy.refillPerSecond,
        });
        if (error) throw new SourceError("transient", "Rate limiter unavailable");
        const wait = Number(data);
        if (wait <= 0) break;
        if (wait * 1000 > MAX_INLINE_WAIT_MS || attempt >= 2) {
          throw new SourceError("rate_limited", `Waiting for ${provider} rate limit`, { retryAfterSeconds: Math.ceil(wait) + 1 });
        }
        await sleep(wait * 1000 + 50);
      }

      const signals = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)];
      if (req.signal) signals.push(req.signal);
      let res: Response;
      try {
        res = await fetch(req.url, { headers: req.headers, signal: AbortSignal.any(signals), cache: "no-store" });
      } catch (e) {
        usage.push({ provider, endpoint: req.endpoint, units: cost, status_code: null });
        const name = e instanceof Error ? e.name : "Error";
        throw new SourceError("transient", `${provider}: network error (${name === "TimeoutError" ? "timeout" : name})`);
      }
      usage.push({ provider, endpoint: req.endpoint, units: cost, status_code: res.status });
      return res;
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
