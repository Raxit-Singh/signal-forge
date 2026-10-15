import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/server/env";

/**
 * Service-role client. BYPASSES ROW LEVEL SECURITY.
 *
 * Rules for callers:
 *   1. Authorize first, with the user-scoped client (e.g. requireWorkspaceRole).
 *   2. Scope every query explicitly by the authorized workspace_id.
 *   3. Never return this client or raw secret rows to the browser.
 */
export function createAdminClient() {
  return createSupabaseClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
