import "server-only";
import { createAdapters, PUBLIC_SOURCES } from "@/lib/sources/registry";
import type { PublicSourceId, SourceAdapter } from "@/lib/sources/types";
import { serverEnv } from "@/lib/server/env";

export function getAdapters(): Record<PublicSourceId, SourceAdapter> {
  const env = serverEnv();
  return createAdapters({
    githubToken: env.GITHUB_TOKEN,
    stackExchangeKey: env.STACKEXCHANGE_KEY,
    youtubeApiKey: env.YOUTUBE_API_KEY,
    apiDirectKey: env.API_DIRECT_API_KEY,
  });
}

/** Paid collection needs an API key AND the explicit server switch (budgets are checked per call). */
export function paidCollectionEnabled(): boolean {
  const env = serverEnv();
  return Boolean(env.API_DIRECT_API_KEY) && env.PAID_SOURCES_ENABLED === "true";
}

export interface SourceSetup {
  id: PublicSourceId;
  name: string;
  configured: boolean;
  paid: boolean;
  reason?: string;
  /** Works, but with lower limits until an optional key is added. */
  note?: string;
}

/** What this server can collect from right now (no secrets exposed). */
export function sourceSetup(): SourceSetup[] {
  const env = serverEnv();
  const adapters = getAdapters();
  const paidOn = paidCollectionEnabled();
  return PUBLIC_SOURCES.map((id) => {
    const a = adapters[id];
    const c = a.configured();
    const paid = Boolean(a.paid);
    let configured = c.ok;
    let reason = c.ok ? undefined : c.reason;
    if (paid && configured && !paidOn) {
      configured = false;
      reason = "Paid sources are switched off on this server (PAID_SOURCES_ENABLED is not true).";
    }
    const note =
      id === "github" && !env.GITHUB_TOKEN ? "No GITHUB_TOKEN: limited to 10 searches/minute shared by all customers."
      : id === "stackexchange" && !env.STACKEXCHANGE_KEY ? "No STACKEXCHANGE_KEY: limited to 300 requests/day."
      : undefined;
    return { id, name: a.name, configured, paid, reason, note };
  });
}

export function configuredSourceIds(): PublicSourceId[] {
  return sourceSetup().filter((s) => s.configured).map((s) => s.id);
}
