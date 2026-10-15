import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, getProducts, getWorkspaces, requireWorkspace } from "@/lib/server/session";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Topbar, type ShellNotification } from "@/components/app-shell/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();
  const [workspaces, products, activeProduct, notifRes, unreadRes] = await Promise.all([
    getWorkspaces(),
    getProducts(workspace.id),
    getActiveProduct(workspace.id),
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
    <div className="flex min-h-dvh">
      <Sidebar current={current} workspaces={shellWorkspaces} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<div className="h-12 border-b" />}>
          <Topbar
            email={user.email ?? ""}
            current={current}
            workspaces={shellWorkspaces}
            products={products.map((p) => ({ id: p.id, name: p.name }))}
            activeProductId={activeProduct?.id ?? null}
            notifications={notifications}
            unread={unreadRes.count ?? 0}
          />
        </Suspense>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-3 py-5 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
