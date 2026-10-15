import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { planFromRow, effectivePlanId, type Plan, type PlanRow, type SubscriptionStatus } from "@/lib/domain/plans";

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";
const RANK: Record<WorkspaceRole, number> = { owner: 40, admin: 30, member: 20, viewer: 10 };

export const WORKSPACE_COOKIE = "sf_ws";
export const PRODUCT_COOKIE = "sf_product";

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  onboardingCompletedAt: string | null;
}

export interface ProductSummary {
  id: string;
  name: string;
  websiteUrl: string | null;
  onboardingStep: number;
}

/** Verified user (validated against Supabase Auth, not just the cookie). */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export const getWorkspaces = cache(async (): Promise<WorkspaceSummary[]> => {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    // FK hint: notification_preferences also links these two tables, which makes a bare embed ambiguous.
    .select("role, workspaces!workspace_members_workspace_id_fkey!inner(id, name, slug, onboarding_completed_at)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to load workspaces: ${error.message}`);
  return (data ?? []).map((row) => {
    const ws = row.workspaces as unknown as { id: string; name: string; slug: string; onboarding_completed_at: string | null };
    return {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      role: row.role as WorkspaceRole,
      onboardingCompletedAt: ws.onboarding_completed_at,
    };
  });
});

/** The workspace the user is working in. Cookie is a hint only; membership is re-checked. */
export const getActiveWorkspace = cache(async (): Promise<WorkspaceSummary | null> => {
  const workspaces = await getWorkspaces();
  if (workspaces.length === 0) return null;
  const cookieStore = await cookies();
  const wanted = cookieStore.get(WORKSPACE_COOKIE)?.value;
  const byCookie = workspaces.find((w) => w.id === wanted);
  if (byCookie) return byCookie;

  const user = await getUser();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("default_workspace_id")
    .eq("id", user!.id)
    .maybeSingle();
  return workspaces.find((w) => w.id === profile?.default_workspace_id) ?? workspaces[0] ?? null;
});

/** For pages inside the app shell: user + workspace, or redirect to onboarding. */
export async function requireWorkspace() {
  const user = await requireUser();
  const workspace = await getActiveWorkspace();
  if (!workspace) redirect("/onboarding");
  return { user, workspace };
}

export class AuthorizationError extends Error {}

/**
 * For server actions. Verifies the user belongs to `workspaceId` with at least
 * `minRole`. Never trusts a workspace id from the client without this check.
 */
export async function requireWorkspaceRole(workspaceId: string, minRole: WorkspaceRole) {
  const user = await getUser();
  if (!user) throw new AuthorizationError("Your session has expired. Sign in again.");
  const workspaces = await getWorkspaces();
  const ws = workspaces.find((w) => w.id === workspaceId);
  if (!ws || RANK[ws.role] < RANK[minRole]) {
    throw new AuthorizationError("You don't have permission to do that in this workspace.");
  }
  return { user, workspace: ws };
}

export function hasRole(role: WorkspaceRole, minRole: WorkspaceRole) {
  return RANK[role] >= RANK[minRole];
}

export const getProducts = cache(async (workspaceId: string): Promise<ProductSummary[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, website_url, onboarding_step")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to load products: ${error.message}`);
  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    websiteUrl: p.website_url as string | null,
    onboardingStep: p.onboarding_step as number,
  }));
});

export const getActiveProduct = cache(async (workspaceId: string): Promise<ProductSummary | null> => {
  const products = await getProducts(workspaceId);
  const cookieStore = await cookies();
  const wanted = cookieStore.get(PRODUCT_COOKIE)?.value;
  return products.find((p) => p.id === wanted) ?? products[0] ?? null;
});

export const getWorkspacePlan = cache(async (workspaceId: string): Promise<{ plan: Plan; status: SubscriptionStatus | null }> => {
  const supabase = await createClient();
  const [{ data: sub }, { data: plans, error }] = await Promise.all([
    supabase.from("subscriptions").select("plan_id, status").eq("workspace_id", workspaceId).maybeSingle(),
    supabase.from("plans").select("*"),
  ]);
  if (error) throw new Error(`Failed to load plans: ${error.message}`);
  const id = effectivePlanId(sub as { plan_id: string; status: SubscriptionStatus } | null);
  const row = (plans ?? []).find((p) => p.id === id) ?? (plans ?? []).find((p) => p.id === "free");
  if (!row) throw new Error("Plan configuration missing (no 'free' plan row).");
  return { plan: planFromRow(row as PlanRow), status: (sub?.status as SubscriptionStatus | undefined) ?? null };
});
