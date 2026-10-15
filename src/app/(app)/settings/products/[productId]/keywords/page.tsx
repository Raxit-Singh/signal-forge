import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { hasRole, requireWorkspace } from "@/lib/server/session";
import { uuidSchema } from "@/lib/validation/schemas";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { KeywordEditor, type EditableAlias } from "@/components/keyword-editor";

export const metadata: Metadata = { title: "Keywords" };

export default async function ProductKeywordsPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const { workspace } = await requireWorkspace();
  if (!hasRole(workspace.role, "admin")) redirect("/settings/products");
  if (!uuidSchema.safeParse(productId).success) notFound();

  const supabase = await createClient();
  const [{ data: product }, { data: aliases }] = await Promise.all([
    supabase.from("products").select("id, name").eq("id", productId).eq("workspace_id", workspace.id).is("archived_at", null).maybeSingle(),
    supabase
      .from("product_aliases")
      .select("term, kind, is_ambiguous, context_terms, negative_terms, enabled, source")
      .eq("product_id", productId)
      .order("created_at"),
  ]);
  if (!product) notFound();

  const initial: EditableAlias[] = (aliases ?? []).map((a) => ({
    term: a.term as string,
    kind: a.kind as EditableAlias["kind"],
    isAmbiguous: a.is_ambiguous as boolean,
    contextTerms: (a.context_terms as string[]) ?? [],
    negativeTerms: (a.negative_terms as string[]) ?? [],
    enabled: a.enabled as boolean,
    source: a.source as EditableAlias["source"],
  }));

  return (
    <>
      <Link href="/settings/products" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Products
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Keywords for {product.name as string}</CardTitle>
          <CardDescription>
            Changes apply to future monitoring runs. Already-collected mentions are not re-matched.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KeywordEditor productId={product.id as string} initial={initial} mode="settings" />
        </CardContent>
      </Card>
    </>
  );
}
