import type { Metadata } from "next";
import Link from "next/link";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/server/session";
import { Logo } from "@/components/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { ActionForm } from "@/components/ai/action-form";
import { acceptInvitationAction } from "@/app/actions/members";
import { signOutAction } from "@/app/(auth)/actions";

export const metadata: Metadata = { title: "Invitation", robots: { index: false } };

const ROLE_TEXT: Record<string, string> = {
  admin: "an admin (manage products, keywords, sources and members)",
  member: "a member (use everything; can't change settings)",
  viewer: "a viewer (read-only)",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
  const user = await getUser(); // the proxy sends signed-out visitors to sign in (or sign up) and back here
  const supabase = await createClient();
  const { data } = valid
    ? await supabase.rpc("get_invitation", { p_token_hash: createHash("sha256").update(token).digest("hex") })
    : { data: null };
  const inv = ((data ?? []) as Array<{ workspace_name: string; role: string; email: string; invited_by_name: string | null; expires_at: string; state: string }>)[0];
  const wrongUser = inv && user?.email && user.email.toLowerCase() !== inv.email;

  return (
    <div className="flex min-h-dvh flex-col bg-surface-2">
      <header className="px-6 py-5"><Link href="/" aria-label="SignalForge home"><Logo /></Link></header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-16">
        <Card className="w-full max-w-md" data-testid="invitation">
          {!inv ? (
            <CardHeader>
              <CardTitle>This invitation link isn&apos;t valid</CardTitle>
              <CardDescription>Check that you copied the whole link, or ask for a new invitation.</CardDescription>
            </CardHeader>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Join {inv.workspace_name}</CardTitle>
                <CardDescription>
                  {inv.invited_by_name ? `${inv.invited_by_name} invited` : "You've been invited:"} {inv.email} to join as {ROLE_TEXT[inv.role] ?? inv.role}.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-[13px]">
                {inv.state === "open" && !wrongUser && (
                  <ActionForm action={acceptInvitationAction} fields={{ token }} label="Accept invitation" pendingLabel="Joining…" variant="default" size="default" />
                )}
                {inv.state === "open" && wrongUser && (
                  <>
                    <p>You&apos;re signed in as <span className="font-medium">{user!.email}</span>, but this invitation is for <span className="font-medium">{inv.email}</span>.</p>
                    <form action={signOutAction}><Button type="submit" variant="secondary" size="sm">Sign out and switch account</Button></form>
                  </>
                )}
                {inv.state === "expired" && <p>This invitation expired on {inv.expires_at.slice(0, 10)}. Ask for a new one.</p>}
                {inv.state === "accepted" && <p>This invitation was already used. <Link href="/overview" className="underline underline-offset-2">Go to SignalForge</Link></p>}
                {inv.state === "revoked" && <p>This invitation was withdrawn. Ask for a new one if you still need access.</p>}
              </CardContent>
            </>
          )}
        </Card>
      </main>
    </div>
  );
}
