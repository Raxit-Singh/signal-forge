import type { z } from "zod";
import { fieldErrors } from "@/lib/validation/schemas";

import type { ActionState } from "@/lib/action-state";

export type { ActionState };

export function invalid(error: z.ZodError, message = "Check the highlighted fields."): ActionState {
  const fields = fieldErrors(error);
  return { status: "error", message: fields._form ?? message, fields };
}

export function failure(message: string): ActionState {
  return { status: "error", message };
}

/** Logs server-side detail without leaking it (or any secret) to the client. */
export function logServerError(scope: string, err: unknown) {
  // PostgREST/Supabase errors are plain objects: keep their code and message.
  const o = err as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown } | null;
  const msg = err instanceof Error
    ? err.message
    : o && typeof o === "object" && (o.message || o.code)
      ? [o.code, o.message, o.details, o.hint].filter((x) => typeof x === "string" && x).join(" | ")
      : String(err);
  // Never pass request bodies or credentials to the logger.
  console.error(`[${scope}] ${msg.slice(0, 500)}`);
}
