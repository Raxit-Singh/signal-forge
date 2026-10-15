import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { CreateWorkspaceForm } from "@/app/onboarding/workspace-form";

export const metadata: Metadata = { title: "New workspace" };

export default function NewWorkspacePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>New workspace</CardTitle>
        <CardDescription>Each workspace has its own products, plan and billing. You can own up to 5.</CardDescription>
      </CardHeader>
      <CardContent>
        <CreateWorkspaceForm />
      </CardContent>
    </Card>
  );
}
