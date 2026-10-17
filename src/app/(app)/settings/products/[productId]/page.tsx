import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { hasRole, requireWorkspace } from "@/lib/server/session";
import { uuidSchema } from "@/lib/validation/schemas";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ProductForm, type ProductValues } from "@/components/product-form";
import { ArchiveProductForm } from "./archive-form";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const { workspace } = await requireWorkspace();
  if (!hasRole(workspace.role, "admin")) redirect("/settings/products");
  if (!uuidSchema.safeParse(productId).success) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("id, name, website_url, description, category, target_audience, app_store_url, play_store_url, github_repo")
    .eq("id", productId)
    .eq("workspace_id", workspace.id)
    .is("archived_at", null)
    .is("competitor_of", null)
    .maybeSingle();
  if (!data) notFound();
  const product = data as ProductValues;

  return (
    <>
      <Link href="/settings/products" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Products
      </Link>
      <Card>
        <CardHeader><CardTitle>{product.name}</CardTitle></CardHeader>
        <CardContent><ProductForm mode="edit" product={product} /></CardContent>
      </Card>
      <Card className="border-negative/40">
        <CardHeader>
          <CardTitle>Archive product</CardTitle>
          <CardDescription>Stops monitoring and frees a product slot. Collected data is kept until your plan&apos;s retention period ends.</CardDescription>
        </CardHeader>
        <CardContent><ArchiveProductForm productId={product.id} name={product.name} /></CardContent>
      </Card>
    </>
  );
}
