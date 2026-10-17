import "server-only";
import { NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";

/** The public origin the MCP resource and authorization server are identified by (no trailing slash). */
export const site = () => publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

/** OAuth error responses (RFC 6749 §5.2). */
export const oauthError = (error: string, description: string, status = 400) => json({ error, error_description: description }, status);

/** Reads application/x-www-form-urlencoded (RFC 6749) or JSON bodies. */
export async function formBody(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  }
  const text = await req.text();
  return Object.fromEntries(new URLSearchParams(text));
}
