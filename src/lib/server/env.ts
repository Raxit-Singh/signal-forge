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
  // SignalForge Intelligence (SYSTEM A; paid by SignalForge). SERVER ONLY. Also needs an
  // operator-set row in ai_global_budget. Customers never supply AI keys for this.
  SIGNALFORGE_AI_ENABLED: z.enum(["true", "false"]).default("false"),
  SIGNALFORGE_AI_PROVIDER: z.string().optional(),
  SIGNALFORGE_GEMINI_API_KEY: z.string().optional(),
  SIGNALFORGE_AI_MODEL: z.string().optional(),
  SIGNALFORGE_AI_DEEP_MODEL: z.string().optional(),
  SIGNALFORGE_EMBEDDING_MODEL: z.string().optional(),
  // Developer agent (SYSTEM B): GitHub App for customer repository authorization.
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  // Email (Resend). EMAIL_FROM must be on a domain verified in Resend, e.g. "SignalForge <reports@mail.example.com>".
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  // Stripe (subscriptions). Test keys (sk_test_…) until launch. The webhook secret is per endpoint (whsec_…).
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Discord bot (Discord source): SignalForge's application. Customers install the bot into their server.
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  // SignalForge staff (comma-separated verified emails): the internal cost dashboard at /admin/costs.
  SIGNALFORGE_STAFF_EMAILS: z.string().default(""),
});

let cached: z.output<typeof serverSchema> | null = null;

/** Lazily validated so a missing optional secret only fails the feature that needs it. */
export function serverEnv() {
  cached ??= serverSchema.parse(process.env);
  return cached;
}
