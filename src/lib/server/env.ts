import "server-only";
import { z } from "zod";

const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20, { error: "SUPABASE_SECRET_KEY is required" }),
  CREDENTIALS_ENCRYPTION_KEY: z.string().optional(),
  CREDENTIALS_KEY_VERSION: z.string().default("1"),
  CREDENTIALS_PREVIOUS_KEYS: z.string().default(""),
  JOBS_TICK_SECRET: z.string().optional(),
  // Data sources (all optional; see ENVIRONMENT_SETUP.md §3).
  GITHUB_TOKEN: z.string().optional(),
  STACKEXCHANGE_KEY: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  // Paid social data (API Direct). Collection also needs PAID_SOURCES_ENABLED=true
  // and an operator-set global budget row (api_budgets, scope 'global').
  API_DIRECT_API_KEY: z.string().optional(),
  PAID_SOURCES_ENABLED: z.enum(["true", "false"]).default("false"),
  // SignalForge AI credits (Milestone 4). SERVER ONLY. Calls also need
  // AI_SIGNALFORGE_ENABLED=true and an operator-set row in ai_global_budget.
  // Customers' own keys (BYOK) don't use these.
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_SIGNALFORGE_ENABLED: z.enum(["true", "false"]).default("false"),
});

let cached: z.output<typeof serverSchema> | null = null;

/** Lazily validated so a missing optional secret only fails the feature that needs it. */
export function serverEnv() {
  cached ??= serverSchema.parse(process.env);
  return cached;
}
