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
  });
}

export interface SourceSetup {
  id: PublicSourceId;
  name: string;
  configured: boolean;
  reason?: string;
  /** Works, but with lower limits until an optional key is added. */
  note?: string;
}

/** What this server can collect from right now (no secrets exposed). */
export function sourceSetup(): SourceSetup[] {
  const env = serverEnv();
  const adapters = getAdapters();
  return PUBLIC_SOURCES.map((id) => {
    const a = adapters[id];
    const c = a.configured();
    const note =
      id === "github" && !env.GITHUB_TOKEN ? "No GITHUB_TOKEN: limited to 10 searches/minute shared by all customers."
      : id === "stackexchange" && !env.STACKEXCHANGE_KEY ? "No STACKEXCHANGE_KEY: limited to 300 requests/day."
      : undefined;
    return { id, name: a.name, configured: c.ok, reason: c.ok ? undefined : c.reason, note };
  });
}

export function configuredSourceIds(): PublicSourceId[] {
  return sourceSetup().filter((s) => s.configured).map((s) => s.id);
}
