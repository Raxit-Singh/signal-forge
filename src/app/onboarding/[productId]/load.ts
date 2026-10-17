import "server-only";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceRole, AuthorizationError } from "@/lib/server/session";
import { uuidSchema } from "@/lib/validation/schemas";

export interface OnboardingProduct {
  id: string;
  workspace_id: string;
  name: string;
  website_url: string | null;
  description: string | null;
  category: string | null;
  target_audience: string | null;
  github_repo: string | null;
  onboarding_step: number;
}

/** Loads a product for onboarding; 404s for anything the user can't see (RLS) or manage. */
export async function loadOnboardingProduct(productId: string): Promise<OnboardingProduct> {
  if (!uuidSchema.safeParse(productId).success) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("id, workspace_id, name, website_url, description, category, target_audience, github_repo, onboarding_step")
    .eq("id", productId)
    .is("archived_at", null)
    .is("competitor_of", null)
    .maybeSingle();
  if (!data) notFound();
  try {
    await requireWorkspaceRole(data.workspace_id as string, "admin");
  } catch (e) {
    if (e instanceof AuthorizationError) redirect("/overview");
    throw e;
  }
  return data as OnboardingProduct;
}
