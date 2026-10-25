import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, hasRole, requireWorkspace } from "@/lib/server/session";
import { playPackage } from "@/lib/sources/google-play";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Disconnect, GooglePlayConnect } from "./connections-client";

export const metadata: Metadata = { title: "Connections" };

/** Accounts the customer owns that SignalForge reads (read-only): Google Play reviews. */
export default async function ConnectionsSettingsPage() {
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  const supabase = await createClient();
  const [{ data: conns }, { data: productRow }] = await Promise.all([
    supabase.from("integrations").select("provider, product_id, status, external_account").eq("workspace_id", workspace.id).eq("provider", "google_play"),
    product ? supabase.from("products").select("play_store_url").eq("id", product.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const canManage = hasRole(workspace.role, "admin");
  const play = (conns ?? []).find((c) => !c.product_id && c.status === "connected");
  const pkg = playPackage((productRow as { play_store_url?: string | null } | null)?.play_store_url);

  return (
    <Card data-testid="connected-sources">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Google Play reviews
          {play ? <Badge tone="positive">Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}
        </CardTitle>
        <CardDescription>
          Collect reviews of your Android app from your own Play Console. SignalForge only reads, and you can disconnect at any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {play ? (
          <>
            <p className="text-[13px] text-muted-foreground">
              Reading as {play.external_account}.
              {product ? (pkg ? ` Collecting reviews of ${pkg} for ${product.name}.` : ` Add ${product.name}'s Google Play URL in product settings to collect its reviews.`) : ""}
            </p>
            {canManage && <Disconnect workspaceId={workspace.id} provider="google_play" label="Disconnect Google Play" />}
          </>
        ) : canManage ? <GooglePlayConnect workspaceId={workspace.id} /> : <p className="text-[13px] text-muted-foreground">A workspace admin can connect your Play Console.</p>}
      </CardContent>
    </Card>
  );
}
