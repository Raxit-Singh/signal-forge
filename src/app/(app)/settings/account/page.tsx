import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/server/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ThemeSwitcher } from "@/components/theme-provider";
import { DeleteAccountForm } from "./delete-form";

export const metadata: Metadata = { title: "Account" };

export default async function AccountSettings() {
  const user = await requireUser();
  const providers = (user.app_metadata?.providers as string[] | undefined) ?? [user.app_metadata?.provider ?? "email"];
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
