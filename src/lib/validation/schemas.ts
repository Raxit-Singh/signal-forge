// Zod schemas shared by server actions. Every server action re-validates its
// input with these; client-side checks are only a convenience.

import { z } from "zod";
import {
  normalizeWebsiteUrl, parseAppStoreUrl, parseGithubRepo, parsePlayStoreUrl,
} from "../domain/urls.ts";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Keep this under ${max} characters.` })
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

/** Optional field that, when present, must pass a domain parser. */
function optionalParsed<T>(parse: (s: string) => { ok: true; value: T } | { ok: false; error: string }) {
  return z
    .string()
    .trim()
    .optional()
    .transform((v, ctx): T | null => {
      if (!v) return null;
      const r = parse(v);
      if (!r.ok) {
        ctx.addIssue({ code: "custom", message: r.error });
        return z.NEVER;
      }
      return r.value;
    });
}

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email({ error: "Enter a valid email address." }));

export const passwordSchema = z
  .string()
  .min(10, { error: "Use at least 10 characters." })
  .max(72, { error: "Use at most 72 characters." })
  .refine((p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p), { error: "Include at least one letter and one number." });

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: "Enter your password." }).max(72),
  next: z.string().optional(),
});

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const resetRequestSchema = z.object({ email: emailSchema });

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { error: "Passwords don't match.", path: ["confirm"] });

export const workspaceNameSchema = z.object({
  name: z.string().trim().min(1, { error: "Name your workspace." }).max(80, { error: "Keep it under 80 characters." }),
});

export const productSchema = z.object({
  name: z.string().trim().min(1, { error: "Enter your product's name." }).max(80, { error: "Keep it under 80 characters." }),
  websiteUrl: optionalParsed(normalizeWebsiteUrl),
  description: optionalText(2000),
  category: optionalText(80),
  targetAudience: optionalText(500),
  appStoreUrl: optionalParsed(parseAppStoreUrl),
  playStoreUrl: optionalParsed(parsePlayStoreUrl),
  githubRepo: optionalParsed(parseGithubRepo),
});
export type ProductInput = z.output<typeof productSchema>;

const termList = z
  .array(z.string().trim().min(2).max(60))
  .max(20)
  .transform((list) => [...new Set(list.map((t) => t.toLowerCase()))]);

export const aliasSchema = z
  .object({
    term: z.string().trim().min(2, { error: "Keywords need at least 2 characters." }).max(100),
    kind: z.enum(["exact_name", "abbreviation", "domain", "misspelling", "handle", "custom"]),
    isAmbiguous: z.boolean(),
    contextTerms: termList,
    negativeTerms: termList,
    enabled: z.boolean(),
    source: z.enum(["suggested", "user"]),
  })
  .refine((a) => !(a.isAmbiguous && a.enabled && a.contextTerms.length === 0), {
    error: "Ambiguous keywords need at least one context term before they can be enabled.",
    path: ["contextTerms"],
  });

export const aliasListSchema = z
  .array(aliasSchema)
  .min(1, { error: "Keep at least one keyword." })
  .max(50, { error: "At most 50 keywords per product." })
  .refine((list) => list.some((a) => a.enabled), { error: "Enable at least one keyword." })
  .refine((list) => new Set(list.map((a) => a.term.toLowerCase())).size === list.length, {
    error: "Each keyword can only appear once.",
  });

export const aiKeySchema = z.object({
  provider: z.enum(["anthropic", "openai", "gemini"]),
  apiKey: z.string().min(1, { error: "Paste your API key." }).max(400),
});

export const uuidSchema = z.uuid();

/** Flattens a ZodError into { field: firstMessage } for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
