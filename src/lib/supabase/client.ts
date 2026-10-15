"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser client: publishable key only. Used sparingly (e.g. realtime later);
// most data loading happens in Server Components.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
