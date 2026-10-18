import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "../(auth)/auth-forms";
import { getUser } from "@/lib/server/session";
import AuthLayout from "../(auth)/layout";

export const metadata: Metadata = { title: "Choose a new password" };

// Reached after /auth/confirm verified a recovery link (which signs the user in).
export default async function ResetPasswordPage() {
  const user = await getUser();
  if (!user) redirect("/forgot-password?error=link_expired");
  return (
    <AuthLayout>
      <div className="grid gap-6">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Choose a new password</h1>
          <p className="text-muted-foreground">For {user.email}</p>
        </div>
        <ResetPasswordForm />
      </div>
    </AuthLayout>
  );
}
