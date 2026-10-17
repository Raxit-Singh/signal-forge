import type { Metadata } from "next";
import Link from "next/link";
import { getActiveWorkspace, requireUser } from "@/lib/server/session";
import { createClient } from "@/lib/supabase/server";
import { emailConfigured } from "@/lib/server/email/send";
import { isStaff } from "@/lib/server/staff";
import { ActionForm } from "@/components/ai/action-form";
import { setWeeklyEmailAction } from "@/app/actions/preferences";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ThemeSwitcher } from "@/components/theme-provider";
import { DeleteAccountForm } from "./delete-form";

export const metadata: Metadata = { title: "Account" };

export default async function AccountSettings() {
  const user = await requireUser();
  const providers = (user.app_metadata?.providers as string[] | undefined) ?? [user.app_metadata?.provider ?? "email"];
  const workspace = await getActiveWorkspace();
  const supabase = await createClient();
  const { data: pref } = workspace
    ? await supabase.from("notification_preferences").select("weekly_report").eq("workspace_id", workspace.id).eq("user_id", user.id).eq("channel", "email").maybeSingle()
    : { data: null };
  const weeklyOn = pref?.weekly_report ?? true;
  const staff = await isStaff();
  return (
    <>
      <Card>
        <CardHeader><CardTitle>Account</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-[13px]">
          <dl className="grid gap-2 sm:grid-cols-[140px_1fr]">
            <dt className="text-muted-foreground">Email</dt>
            <dd>{user.email} {user.email_confirmed_at ? "" : <span className="text-negative">(unverified)</span>}</dd>
            <dt className="text-muted-foreground">Sign-in methods</dt>
            <dd className="capitalize">{providers.join(", ")}</dd>
            <dt className="text-muted-foreground">Theme</dt>
            <dd><ThemeSwitcher /></dd>
          </dl>
          {providers.includes("email") && (
            <Link href="/forgot-password" className="justify-self-start text-[13px] underline-offset-4 hover:underline">
              Change password
            </Link>
          )}
        </CardContent>
      </Card>
      {workspace && (
        <Card data-testid="email-settings">
          <CardHeader>
            <CardTitle>Email</CardTitle>
            <CardDescription>
              For {workspace.name}. {emailConfigured() ? "" : "Email isn't set up on this server yet, so nothing is sent for now."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
            <span>Weekly report emails: <span className="font-medium">{weeklyOn ? "on" : "off"}</span> <span className="text-muted-foreground">— every Monday, a summary of the week before.</span></span>
            <ActionForm action={setWeeklyEmailAction} fields={{ workspaceId: workspace.id, weekly: weeklyOn ? "off" : "on" }} label={weeklyOn ? "Turn off" : "Turn on"} />
          </CardContent>
        </Card>
      )}
      {staff && (
        <Card>
          <CardHeader><CardTitle>SignalForge staff</CardTitle></CardHeader>
          <CardContent className="text-[13px]"><Link href="/admin/costs" className="underline underline-offset-2">Costs dashboard</Link></CardContent>
        </Card>
      )}
      <Card className="border-negative/40">
        <CardHeader>
          <CardTitle>Delete account</CardTitle>
          <CardDescription>
            Deletes your login and every workspace you solely own, including all their data. This can&apos;t be undone.
          </CardDescription>
        </CardHeader>
        <CardContent><DeleteAccountForm /></CardContent>
      </Card>
    </>
  );
}
