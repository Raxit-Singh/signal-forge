import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, hasRole, requireWorkspace } from "@/lib/server/session";
import { discordConfig } from "@/lib/server/collection/manage-connections";
import { playPackage } from "@/lib/sources/google-play";
import { Button } from "@/components/ui/button";
import { CardDescription } from "@/components/ui/primitives";
import { DiscordChannels, Disconnect, GooglePlayConnect } from "./connections-client";
import { getCoverageSummary, type CoverageState } from "@/lib/server/collection/status";
import { integrationInfo } from "@/lib/domain/integrations";
import { formatRelative, formatUtc } from "@/lib/format";
import { PageHeader } from "@/components/page";
import { IntegrationList, type LiveStatus } from "@/components/integration-list";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Integrations" };

const STATE: Record<CoverageState, LiveStatus["tone"]> = {
  live: "positive", partial: "warning", failing: "negative", not_configured: "neutral", not_enabled: "neutral", not_started: "neutral",
};
const STATE_LABEL: Record<CoverageState, string> = {
  live: "Collecting", partial: "Collecting · incomplete", failing: "Problem", not_configured: "Not configured", not_enabled: "Not enabled", not_started: "Not scanned yet",
};

interface JobRow {
  id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  result: { provider?: string; inserted?: number; complete?: boolean; incompleteReason?: string; skipped?: string } | null;
  created_at: string;
  finished_at: string | null;
  scan_id: string | null;
}

const DISCORD_RESULT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Discord connected. Choose the channels to read below." },
  cancelled: { ok: false, text: "Discord setup was cancelled." },
  expired: { ok: false, text: "That Discord setup link expired. Start again." },
  denied: { ok: false, text: "Discord didn't confirm the installation. Add the bot again." },
  forbidden: { ok: false, text: "Only workspace admins can connect Discord." },
  not_configured: { ok: false, text: "Discord isn't configured on this server yet." },
  invalid: { ok: false, text: "That Discord setup request wasn't valid." },
  failed: { ok: false, text: "Couldn't finish connecting Discord. Try again." },
};

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ discord?: string }> }) {
  const { workspace } = await requireWorkspace();
  const discordResult = DISCORD_RESULT[(await searchParams).discord ?? ""];
  const product = await getActiveProduct(workspace.id);
  const supabase = await createClient();

  const [coverage, { data: health }, { data: jobs }, { data: conns }, { data: productRow }] = await Promise.all([
    product ? getCoverageSummary(product.id) : null,
    supabase.from("source_health").select("provider, status, last_success_at, last_error_at, last_error, detail"),
    supabase
      .from("jobs")
      .select("id, status, attempts, max_attempts, last_error, result, created_at, finished_at, scan_id")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("integrations").select("provider, product_id, status, config, external_account, updated_at").eq("workspace_id", workspace.id).in("provider", ["google_play", "discord"]),
    product ? supabase.from("products").select("play_store_url").eq("id", product.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const canManage = hasRole(workspace.role, "admin");
  const play = (conns ?? []).find((c) => c.provider === "google_play" && !c.product_id && c.status === "connected");
  const disc = product ? (conns ?? []).find((c) => c.provider === "discord" && c.product_id === product.id && c.status === "connected") : undefined;
  const dcfg = disc?.config as { guild_name?: string; channels?: Array<{ id: string; name: string }>; available_channels?: Array<{ id: string; name: string }>; mode?: "all" | "keywords" } | undefined;
  const pkg = playPackage((productRow as { play_store_url?: string | null } | null)?.play_store_url);

  const healthBy = new Map((health ?? []).map((h) => [h.provider as string, h]));
  const live: Record<string, LiveStatus> = {};
  for (const s of coverage?.sources ?? []) {
    const h = healthBy.get(s.id);
    const lines: string[] = [];
    if (s.lastCoveredAt) lines.push(`Searched up to ${formatRelative(s.lastCoveredAt)} (${formatUtc(s.lastCoveredAt)}).`);
    if (s.detail && s.state !== "live") lines.push(s.detail);
    if (s.note) lines.push(s.note);
    if (h?.status === "degraded" && h.last_error_at && (!h.last_success_at || h.last_error_at > h.last_success_at)) {
      lines.push(`Recent issue: ${h.last_error}`);
    }
    live[s.id] = { tone: STATE[s.state], label: STATE_LABEL[s.state], lines };
  }

  return (
    <>
      <PageHeader
        title="Integrations"
        description={<>Data sources SignalForge uses, what each can access, and their live status{product ? <> for {product.name}</> : null}.</>}
      />
      <div className="grid gap-6">
        {discordResult && (
          <p role={discordResult.ok ? "status" : "alert"} className={`rounded-md border px-3 py-2 text-[13px] ${discordResult.ok ? "border-positive/30 text-positive" : "border-negative/30 text-negative"}`}>{discordResult.text}</p>
        )}
        <Card data-testid="connected-sources">
          <CardHeader>
            <CardTitle>Your own accounts</CardTitle>
            <CardDescription>Sources that read accounts you own. You authorize each one; SignalForge only reads, and you can disconnect at any time.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <section className="grid content-start gap-2" aria-labelledby="gp">
              <div className="flex items-center gap-2"><h3 id="gp" className="text-[13px] font-semibold">Google Play reviews</h3>
                {play ? <Badge tone="positive">Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}</div>
              {play ? (
                <>
                  <p className="text-[13px] text-muted-foreground">Reading as {play.external_account}.{product ? (pkg ? ` Collecting reviews of ${pkg} for ${product.name}.` : ` Add ${product.name}'s Google Play URL in product settings to collect its reviews.`) : ""}</p>
                  {canManage && <Disconnect workspaceId={workspace.id} provider="google_play" label="Disconnect Google Play" />}
                </>
              ) : canManage ? <GooglePlayConnect workspaceId={workspace.id} /> : <p className="text-[13px] text-muted-foreground">A workspace admin can connect your Play Console.</p>}
            </section>
            <section className="grid content-start gap-2" aria-labelledby="dc">
              <div className="flex items-center gap-2"><h3 id="dc" className="text-[13px] font-semibold">Discord{product ? ` for ${product.name}` : ""}</h3>
                {disc ? <Badge tone={(dcfg?.channels?.length ?? 0) > 0 ? "positive" : "warning"}>{(dcfg?.channels?.length ?? 0) > 0 ? "Connected" : "Choose channels"}</Badge> : <Badge tone="neutral">Not connected</Badge>}</div>
              {!product ? <p className="text-[13px] text-muted-foreground">Add a product first.</p>
                : disc ? (
                  <>
                    <p className="text-[13px] text-muted-foreground">Server: {dcfg?.guild_name ?? disc.external_account}. The bot can only view channels and read history.</p>
                    {canManage && <DiscordChannels workspaceId={workspace.id} productId={product.id} available={dcfg?.available_channels ?? []} chosen={(dcfg?.channels ?? []).map((c) => c.id)} mode={dcfg?.mode ?? "all"} />}
                    {canManage && <Disconnect workspaceId={workspace.id} provider="discord" productId={product.id} label="Disconnect Discord" />}
                  </>
                ) : !discordConfig() ? <p className="text-[13px] text-muted-foreground">Discord isn&apos;t configured on this server yet.</p>
                : canManage ? (
                  <>
                    <p className="text-[13px] text-muted-foreground">Add SignalForge&apos;s bot to your server (you need Manage Server there), then choose channels. It asks only for View Channels and Read Message History.</p>
                    <div><Button asChild size="sm"><a href={`/api/discord/install?product=${product.id}`}>Add bot to Discord</a></Button></div>
                  </>
                ) : <p className="text-[13px] text-muted-foreground">A workspace admin can connect your Discord server.</p>}
            </section>
          </CardContent>
        </Card>
        <IntegrationList live={live} />

        <Card>
          <CardHeader><CardTitle>Monitoring activity</CardTitle></CardHeader>
          <CardContent>
            {(jobs ?? []).length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No collection runs yet. They appear here after the first scan.</p>
            ) : (
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <caption className="sr-only">Recent collection runs</caption>
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-1 py-1.5 font-medium">Started</th>
                      <th scope="col" className="px-1 py-1.5 font-medium">Source</th>
                      <th scope="col" className="px-1 py-1.5 font-medium">Type</th>
                      <th scope="col" className="px-1 py-1.5 font-medium">Status</th>
                      <th scope="col" className="px-1 py-1.5 text-right font-medium">New</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(jobs as JobRow[]).map((j) => (
                      <tr key={j.id} className="align-top">
                        <td className="px-1 py-1.5 whitespace-nowrap" title={formatUtc(j.created_at)}>{formatRelative(j.created_at)}</td>
                        <td className="px-1 py-1.5">{j.result?.provider ? integrationInfo(j.result.provider as never)?.name ?? j.result.provider : "—"}</td>
                        <td className="px-1 py-1.5 text-muted-foreground">{j.scan_id ? "Scan" : "Scheduled"}</td>
                        <td className="px-1 py-1.5">
                          <JobStatus j={j} />
                        </td>
                        <td className="px-1 py-1.5 text-right tabular">{j.result?.inserted ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function JobStatus({ j }: { j: JobRow }) {
  if (j.status === "succeeded") {
    if (j.result?.skipped) return <Badge>Skipped · {j.result.skipped.replace(/_/g, " ")}</Badge>;
    return j.result?.complete === false
      ? <span className="grid gap-0.5"><Badge tone="warning">Incomplete</Badge><span className="text-xs text-muted-foreground">{j.result.incompleteReason}</span></span>
      : <Badge tone="positive">Done</Badge>;
  }
  if (j.status === "dead") return <span className="grid gap-0.5"><Badge tone="negative">Failed</Badge><span className="text-xs text-muted-foreground">{j.last_error}</span></span>;
  if (j.status === "running") return <Badge tone="info">Running</Badge>;
  if (j.status === "queued" && j.last_error) {
    return <span className="grid gap-0.5"><Badge tone="warning">Retrying</Badge><span className="text-xs text-muted-foreground">{j.last_error}</span></span>;
  }
  return <Badge>{j.status === "queued" ? "Queued" : j.status}</Badge>;
}
