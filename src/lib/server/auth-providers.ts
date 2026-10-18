import "server-only";
import { publicEnv } from "@/lib/env";
import { NO_PROVIDERS, providersFromSettings, type ProviderAvailability } from "@/lib/auth/flow";

// Which social sign-in providers are switched on in Supabase Auth, read from
// its public settings endpoint (no secrets involved). Cached for a minute so
// the login page doesn't call Supabase on every render.

let cached: { at: number; value: ProviderAvailability } | null = null;
const TTL_MS = 60_000;

export async function getAuthProviders(): Promise<ProviderAvailability> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const res = await fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`settings ${res.status}`);
    const value = providersFromSettings(await res.json());
    cached = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.error(`[authProviders] ${err instanceof Error ? err.message : String(err)}`);
    // Unknown: show email only rather than buttons that might fail.
    return { ...NO_PROVIDERS };
  }
}
