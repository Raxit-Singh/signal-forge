import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mentionUsageLevel, usageFromRpc } from "@/lib/domain/plans";
import { allowanceNotice, type NotificationKind } from "@/lib/notifications";

export interface NewNotification {
  workspaceId: string;
  productId?: string | null;
  /** null = every member of the workspace. */
  userId?: string | null;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  /** A path inside the app. */
  link?: string | null;
  /** The same key in a workspace is stored once, so an event is never announced twice. */
  dedupeKey: string;
}

/** Adds a notification to the bell (service role). Never throws: a notification is never worth failing a job for. */
export async function notify(admin: SupabaseClient, n: NewNotification): Promise<void> {
  try {
    const { error } = await admin.from("notifications").upsert({
      workspace_id: n.workspaceId, product_id: n.productId ?? null, user_id: n.userId ?? null, kind: n.kind,
      title: n.title.slice(0, 200), body: n.body?.slice(0, 4000) ?? null, link: n.link?.startsWith("/") ? n.link : null,
      dedupe_key: n.dedupeKey.slice(0, 200),
    }, { onConflict: "workspace_id,dedupe_key", ignoreDuplicates: true });
    if (error) console.error(`[notify] ${n.kind} not stored (${error.code ?? "db"})`);
  } catch (e) {
    console.error(`[notify] ${n.kind}: ${e instanceof Error ? e.message : e}`);
  }
}

/** After mentions are delivered: a notice at 80 % and 90 % of the month's allowance and when it's used up (once each per period). */
export async function notifyAllowance(admin: SupabaseClient, workspaceId: string): Promise<void> {
  try {
    const { data, error } = await admin.rpc("svc_workspace_usage", { p_workspace_id: workspaceId });
    if (error || !data) return;
    const u = usageFromRpc(data as Record<string, unknown>);
    const { level, percent } = mentionUsageLevel(u.mentionsConsumed, u.mentionAllowance);
    const notice = allowanceNotice(level, percent, u.mentionAllowance, u.periodEnd);
    if (!notice) return;
    await notify(admin, { workspaceId, kind: "system", ...notice, link: "/settings/billing", dedupeKey: `allowance:${u.periodStart.slice(0, 10)}:${level}` });
  } catch (e) {
    console.error(`[notify] allowance: ${e instanceof Error ? e.message : e}`);
  }
}
