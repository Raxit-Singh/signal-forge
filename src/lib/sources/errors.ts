export type SourceErrorKind =
  | "rate_limited"   // our limiter or the platform said "slow down"; retry later without penalty
  | "quota"          // daily quota exhausted; retry after the reset
  | "auth"           // credentials missing or rejected; retrying won't help
  | "bad_request"    // our query was rejected; retrying won't help
  | "transient";     // 5xx, network, timeout; retry with backoff

export class SourceError extends Error {
  readonly kind: SourceErrorKind;
  readonly retryAfterSeconds?: number;
  readonly status?: number;

  constructor(kind: SourceErrorKind, message: string, opts: { retryAfterSeconds?: number; status?: number } = {}) {
    super(message);
    this.name = "SourceError";
    this.kind = kind;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.status = opts.status;
  }

  get retryable() {
    return this.kind === "rate_limited" || this.kind === "quota" || this.kind === "transient";
  }
}

/** Parses Retry-After (seconds or HTTP date). */
export function retryAfterSeconds(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const n = Number(header);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const t = Date.parse(header);
  return Number.isNaN(t) ? undefined : Math.max(0, Math.ceil((t - now) / 1000));
}

/** Generic mapping for HTTP failures; adapters handle platform-specific bodies first. */
export function httpError(source: string, res: Response, now = Date.now()): SourceError {
  const ra = retryAfterSeconds(res.headers.get("retry-after"), now);
  if (res.status === 429) return new SourceError("rate_limited", `${source}: rate limited (429)`, { retryAfterSeconds: ra ?? 60, status: 429 });
  if (res.status === 401 || res.status === 403) return new SourceError("auth", `${source}: access denied (${res.status})`, { status: res.status });
  if (res.status >= 500) return new SourceError("transient", `${source}: server error (${res.status})`, { retryAfterSeconds: ra, status: res.status });
  return new SourceError("bad_request", `${source}: request rejected (${res.status})`, { status: res.status });
}

/** Seconds until the next UTC midnight (Stack Exchange quota reset). */
export function secondsUntilUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
}

/** Seconds until the next midnight in America/Los_Angeles (YouTube quota reset). */
export function secondsUntilPacificMidnight(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const elapsed = (get("hour") % 24) * 3600 + get("minute") * 60 + get("second");
  return Math.max(60, 86_400 - elapsed);
}
