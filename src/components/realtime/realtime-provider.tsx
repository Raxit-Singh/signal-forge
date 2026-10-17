"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

// Live dashboard updates. The worker writes one small row to `workspace_events`
// per finished batch (never per mention, never mention content); Supabase
// Realtime delivers it only to members of that workspace (RLS on the table).
// Each event is a signal: the page re-fetches authoritative data from the server
// (router.refresh), debounced so a busy scan causes a few refreshes, not thousands.
// After a disconnect, a suspended tab or a network change the page re-fetches
// once; while the connection is down a slow fallback refresh keeps it current.

export interface WorkspaceEvent {
  id: number;
  workspace_id: string;
  product_id: string | null;
  kind: "mentions" | "monitoring" | "backfill" | "usage" | "spikes" | "ai" | "resync";
  payload: Record<string, unknown>;
  created_at: string;
}

export type LiveStatus = "connecting" | "live" | "offline";

interface RealtimeApi {
  status: LiveStatus;
  /** Listen to events (e.g. the Mentions page counting new mentions while on an older page). */
  subscribe: (fn: (e: WorkspaceEvent) => void) => () => void;
  /** While held (e.g. reading an older page), events don't replace the page content. */
  hold: (key: string, on: boolean) => void;
}

const Ctx = createContext<RealtimeApi | null>(null);
export const useRealtime = () => useContext(Ctx);

const DEBOUNCE_MS = 1500;
const MIN_GAP_MS = 4000;
const FALLBACK_POLL_MS = 60_000;
const HIDDEN_RESYNC_MS = 30_000;
const CATCH_UP_MS = 2500;

export function RealtimeProvider({ workspaceId, productId, children }: { workspaceId: string; productId: string | null; children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const listeners = useRef(new Set<(e: WorkspaceEvent) => void>());
  const holds = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefresh = useRef(0);
  const productRef = useRef(productId);
  useEffect(() => {
    productRef.current = productId;
  }, [productId]);

  const refreshSoon = useCallback(() => {
    if (holds.current.size > 0) return;
    if (timer.current) clearTimeout(timer.current);
    const wait = Math.max(DEBOUNCE_MS, lastRefresh.current + MIN_GAP_MS - Date.now());
    timer.current = setTimeout(() => {
      timer.current = null;
      if (holds.current.size > 0) return;
      lastRefresh.current = Date.now();
      router.refresh();
    }, wait);
  }, [router]);

  const dispatch = useCallback((e: WorkspaceEvent) => {
    // Other products' batches don't change this view (usage is workspace-wide).
    if (e.kind !== "usage" && e.kind !== "resync" && e.product_id && productRef.current && e.product_id !== productRef.current) return;
    for (const fn of listeners.current) fn(e);
    refreshSoon();
  }, [refreshSoon]);

  const resync = useCallback(() => {
    dispatch({ id: 0, workspace_id: workspaceId, product_id: null, kind: "resync", payload: {}, created_at: new Date().toISOString() });
  }, [dispatch, workspaceId]);

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let wasDown = false;
    let disposed = false;
    let catchUp: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      // Realtime authorizes with the user's own token (RLS decides which events arrive).
      const { data } = await supabase.auth.getSession();
      if (disposed) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      channel = supabase
        .channel(`workspace-events:${workspaceId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "workspace_events", filter: `workspace_id=eq.${workspaceId}` },
          (msg) => dispatch(msg.new as WorkspaceEvent))
        .subscribe((s) => {
          if (disposed) return;
          if (s === "SUBSCRIBED") {
            setStatus("live");
            // Recover anything stored while disconnected — or, on first connect, between the
            // server render and the subscription becoming active (a short warm-up window).
            if (wasDown) resync();
            else catchUp = setTimeout(resync, CATCH_UP_MS);
            wasDown = false;
          } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
            setStatus("offline");
            wasDown = true;
          }
        });
    };
    void connect();

    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        if (channel) void supabase.removeChannel(channel);
        channel = null;
        setStatus("offline");
      } else if (session && (event === "TOKEN_REFRESHED" || event === "SIGNED_IN")) {
        void supabase.realtime.setAuth(session.access_token);
      }
    });

    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > HIDDEN_RESYNC_MS) resync();
    };
    const onOnline = () => resync();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);

    return () => {
      disposed = true;
      authSub.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      if (channel) void supabase.removeChannel(channel);
      if (timer.current) clearTimeout(timer.current);
      if (catchUp) clearTimeout(catchUp);
    };
  }, [workspaceId, dispatch, resync]);

  // Fallback: while the live connection is down, refresh slowly (visible tabs only).
  useEffect(() => {
    if (status === "live") return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") resync();
    }, FALLBACK_POLL_MS);
    return () => clearInterval(id);
  }, [status, resync]);

  const api = useMemo<RealtimeApi>(() => ({
    status,
    subscribe: (fn) => {
      listeners.current.add(fn);
      return () => listeners.current.delete(fn);
    },
    hold: (key, on) => {
      if (on) holds.current.add(key);
      else holds.current.delete(key);
    },
  }), [status]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/** Small "Live" / "Reconnecting" indicator (no animation). */
export function LiveIndicator() {
  const rt = useRealtime();
  if (!rt) return null;
  const label = rt.status === "live" ? "Live" : rt.status === "connecting" ? "Connecting…" : "Reconnecting — refreshing every minute";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="live-indicator" data-status={rt.status} title="Pages update automatically when new data is stored">
      <span aria-hidden className={rt.status === "live" ? "size-1.5 rounded-full bg-positive" : "size-1.5 rounded-full bg-warning"} />
      <span role="status">{label}</span>
    </span>
  );
}
