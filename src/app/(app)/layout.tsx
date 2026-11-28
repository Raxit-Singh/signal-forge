import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getActiveProduct, getProducts, getWorkspaces, getWorkspaceUsage, hasRole, requireWorkspace } from "@/lib/server/session";
import { UsageBanner } from "@/components/usage-banner";
import { getTimeZone } from "@/lib/server/timezone";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Topbar, type ShellNotification } from "@/components/app-shell/topbar";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { MotionProvider } from "@/components/motion";
import { Toaster } from "@/components/toaster";
import { ProductTour } from "@/components/app-shell/product-tour";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();
  const activeProduct = await getActiveProduct(workspace.id);
  // Setup isn't finished (browser Back, or the logo during onboarding): go back to the step the admin was on rather
  // than an empty dashboard. /onboarding resumes it. Members can't run onboarding, so they're let in.
  if (!workspace.onboardingCompletedAt && hasRole(workspace.role, "admin")) {
    const all = await getProducts(workspace.id);
    if (all.length === 0) redirect("/onboarding/product");
    if (all.some((p) => p.onboardingStep < 6)) redirect("/onboarding");
  }
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const [workspaces, products, notifRes, unreadRes, usage, recentRes, openRes, profileRes] = await Promise.all([
    getWorkspaces(),
    getProducts(workspace.id),
    supabase
      .from("notifications")
      .select("id, title, body, link, created_at, read_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .is("read_at", null),
    getWorkspaceUsage(workspace.id),
    // Sidebar badges: new mentions in the last day and open issues for the active product.
    activeProduct
      ? supabase.from("mentions").select("id", { count: "exact", head: true }).eq("product_id", activeProduct.id)
          .eq("dedup_kind", "original").in("relevance_status", ["relevant", "user_relevant"]).gte("published_at", since)
      : Promise.resolve({ count: 0 }),
    activeProduct
      ? supabase.from("feedback_clusters").select("id", { count: "exact", head: true }).eq("product_id", activeProduct.id).in("status", ["open", "acknowledged"])
      : Promise.resolve({ count: 0 }),
    supabase.from("profiles").select("tour_completed_at").eq("id", user.id).maybeSingle(),
  ]);

  const notifications: ShellNotification[] = (notifRes.data ?? []).map((n) => ({
    id: n.id as string,
    title: n.title as string,
    body: n.body as string | null,
    link: typeof n.link === "string" && n.link.startsWith("/") ? n.link : null,
    createdAt: n.created_at as string,
    read: n.read_at !== null,
  }));

  const shellWorkspaces = workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role }));
  const current = { id: workspace.id, name: workspace.name, role: workspace.role };

  return (
    <RealtimeProvider key={workspace.id} workspaceId={workspace.id} productId={activeProduct?.id ?? null}>
    <MotionProvider>
    <div className="flex min-h-dvh">
      <Sidebar
        current={current}
        workspaces={shellWorkspaces}
        products={products.map((p) => ({ id: p.id, name: p.name }))}
        activeProductId={activeProduct?.id ?? null}
        counts={{ mentions24h: recentRes.count ?? 0, openIssues: openRes.count ?? 0 }}
        plan={usage ? { name: usage.planName, used: usage.mentionsConsumed, allowance: usage.mentionAllowance, upgrade: usage.planName.toLowerCase() === "free" } : null}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<div className="h-12 border-b" />}>
          <Topbar
            email={user.email ?? ""}
            current={current}
            workspaces={shellWorkspaces}
            products={products.map((p) => ({ id: p.id, name: p.name }))}
            activeProductId={activeProduct?.id ?? null}
            counts={{ mentions24h: recentRes.count ?? 0, openIssues: openRes.count ?? 0 }}
            notifications={notifications}
            unread={unreadRes.count ?? 0}
          />
        </Suspense>
        <main id="main" className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="print:hidden"><UsageBanner usage={usage} tz={await getTimeZone()} /></div>
          {children}
        </main>
      </div>
    </div>
    <Toaster />
    {/* Shown once, after onboarding (a product exists); errors reading the profile never show it. */}
    <ProductTour autoStart={Boolean(activeProduct) && profileRes.data !== null && !(profileRes.data as { tour_completed_at: string | null }).tour_completed_at} />
    </MotionProvider>
    </RealtimeProvider>
  );
}
