import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getActiveWorkspace, getProducts, getWorkspacePlan, hasRole } from "@/lib/server/session";
import { checkProductLimit } from "@/lib/domain/plans";
import { Card, CardContent } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { StepHeader } from "../steps";
import { ProductForm } from "@/components/product-form";

export const metadata: Metadata = { title: "Add your product" };

export default async function AddProductPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) redirect("/onboarding");

  const [products, { plan }] = await Promise.all([getProducts(workspace.id), getWorkspacePlan(workspace.id)]);
  const limit = checkProductLimit(plan, products.length);
  const canManage = hasRole(workspace.role, "admin");

  return (
    <>
      <StepHeader
        step={1}
        title="Add your product"
        description="Tell us what to listen for. Only the name is required — the rest improves matching and later analysis."
      />
      {!canManage ? (
        <Card><CardContent>Only workspace admins can add products. Ask an owner or admin to add it.</CardContent></Card>
      ) : !limit.allowed ? (
        <Card>
          <CardContent className="grid gap-3">
            <p>{limit.message}</p>
            <div className="flex gap-2">
              <Button asChild variant="secondary"><Link href="/settings/products">Manage products</Link></Button>
              <Button asChild><Link href="/settings/billing">See plans</Link></Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <ProductForm mode="create" />
          </CardContent>
        </Card>
      )}
    </>
  );
}
