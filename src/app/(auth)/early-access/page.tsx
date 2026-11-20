import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { signOutAction } from "../actions";

export const metadata: Metadata = { title: "Opening soon", robots: { index: false } };

/** Where signed-in people land while Heardex is in private testing and their address is not on the list. */
export default async function EarlyAccessPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Heardex isn&apos;t open yet</h1>
        <p className="text-muted-foreground">
          We&apos;re testing everything before the doors open. {user ? "Your account is kept, and you can sign in here once Heardex opens." : "Sign-ups open soon."}
        </p>
        <p className="text-muted-foreground">
          Want early access? <Link href="/legal/contact" className="font-medium text-foreground underline underline-offset-2">Get in touch</Link>.
        </p>
      </div>
      {user ? (
        <div className="grid gap-3">
          <p className="text-[13px] text-muted-foreground">Signed in as <span className="text-foreground">{user.email}</span></p>
          <form action={signOutAction}><Button type="submit" variant="secondary" className="w-full">Sign out</Button></form>
        </div>
      ) : (
        <Button asChild variant="secondary"><Link href="/">Back to the home page</Link></Button>
      )}
    </div>
  );
}
