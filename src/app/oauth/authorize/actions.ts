"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authorizeSchema, clientRedirect, parseScopes, redirectMatches, resourceUrl } from "@/lib/agent/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClient, issueCode } from "@/lib/server/agent/oauth-store";
import { site } from "@/lib/server/agent/http";
import { AuthorizationError, requireWorkspaceRole } from "@/lib/server/session";

// Consent decision. Server actions only accept same-origin POSTs (Next.js checks
// the Origin header), so a third-party page can't approve on the user's behalf.
// Every parameter is validated again here; nothing from the page is trusted.
export async function decideAuthorizationAction(formData: FormData): Promise<void> {
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const parsed = authorizeSchema.safeParse(raw);
  if (!parsed.success) redirect("/overview");
  const req = parsed.data;
  const admin = createAdminClient();
  const client = await getClient(admin, req.client_id);
  if (!client || !redirectMatches(client.redirect_uris, req.redirect_uri)) redirect("/overview");

  if (raw.decision !== "approve") redirect(clientRedirect(req.redirect_uri, { error: "access_denied", state: req.state }));
  const scopes = parseScopes(req.scope);
  if (!scopes) redirect(clientRedirect(req.redirect_uri, { error: "invalid_scope", state: req.state }));
  const workspaceId = z.uuid().safeParse(raw.workspace_id);
  if (!workspaceId.success) redirect(clientRedirect(req.redirect_uri, { error: "access_denied", state: req.state }));

  let userId: string;
  try {
    userId = (await requireWorkspaceRole(workspaceId.data, "member")).user.id;
  } catch (e) {
    if (e instanceof AuthorizationError) redirect(clientRedirect(req.redirect_uri, { error: "access_denied", state: req.state }));
    throw e;
  }
  const code = await issueCode(admin, {
    clientId: req.client_id, userId, workspaceId: workspaceId.data, scopes: scopes!, resource: resourceUrl(site()),
    redirectUri: req.redirect_uri, codeChallenge: req.code_challenge,
  });
  redirect(clientRedirect(req.redirect_uri, { code, state: req.state, iss: site() }));
}
