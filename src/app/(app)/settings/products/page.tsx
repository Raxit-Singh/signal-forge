import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getProducts, getWorkspacePlan, hasRole, requireWorkspace } from "@/lib/server/session";
import { checkProductLimit } from "@/lib/domain/plans";
import { Badge, Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsSettings() {
  const { workspace } = await requireWorkspace();
  const [products, { plan }] = await Promise.all([getProducts(workspace.id), getWorkspacePlan(workspace.id)]);
  const limit = checkProductLimit(plan, products.length);
  const isAdmin = hasRole(workspace.role, "admin");

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div className="grid gap-1">
          <CardTitle>Products</CardTitle>
          <CardDescription className="tabular">
            {products.length} of {plan.maxProducts} on the {plan.name} plan
          </CardDescription>
        </div>
        {isAdmin && (limit.allowed ? (
          <Button asChild size="sm"><Link href="/onboarding/product"><Plus /> Add product</Link></Button>
        ) : (
          <Button asChild size="sm" variant="secondary"><Link href="/settings/billing">Upgrade for more</Link></Button>
        ))}
      </CardHeader>
      {products.length === 0 ? (
        <p className="p-6 text-center text-[13px] text-muted-foreground">No products yet.</p>
      ) : (
        <ul className="divide-y">
          {products.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <span className="font-medium">{p.name}</span>
              {p.websiteUrl && <span className="truncate text-xs text-muted-foreground">{p.websiteUrl.replace(/^https?:\/\//, "")}</span>}
              {p.onboardingStep < 6 && <Badge tone="warning">Setup incomplete</Badge>}
              {isAdmin && (
                <span className="ml-auto flex gap-1">
                  <Button asChild variant="ghost" size="sm"><Link href={`/settings/products/${p.id}/keywords`}>Keywords</Link></Button>
                  <Button asChild variant="ghost" size="sm"><Link href={`/settings/products/${p.id}`}>Edit</Link></Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
