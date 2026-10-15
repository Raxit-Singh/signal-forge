import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { suggestAliases, type AliasSuggestion } from "@/lib/domain/aliases";
import { normalizeWebsiteUrl } from "@/lib/domain/urls";
import { Card, CardContent } from "@/components/ui/primitives";
import { KeywordEditor, type EditableAlias } from "@/components/keyword-editor";
import { StepHeader } from "../../steps";
import { loadOnboardingProduct } from "../load";

export const metadata: Metadata = { title: "Keywords" };

export default async function KeywordsStep({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await loadOnboardingProduct(productId);

  const supabase = await createClient();
  const { data: saved } = await supabase
    .from("product_aliases")
    .select("term, kind, is_ambiguous, context_terms, negative_terms, enabled, source")
    .eq("product_id", product.id)
    .order("created_at");

  let initial: EditableAlias[];
  if (saved && saved.length > 0) {
    initial = saved.map((a) => ({
      term: a.term as string,
      kind: a.kind as EditableAlias["kind"],
      isAmbiguous: a.is_ambiguous as boolean,
      contextTerms: (a.context_terms as string[]) ?? [],
      negativeTerms: (a.negative_terms as string[]) ?? [],
      enabled: a.enabled as boolean,
      source: a.source as EditableAlias["source"],
    }));
  } else {
    const site = product.website_url ? normalizeWebsiteUrl(product.website_url) : null;
    initial = suggestAliases({
      name: product.name,
      websiteDomain: site?.ok ? site.value.domain : null,
      githubRepo: product.github_repo,
      category: product.category,
      description: product.description,
    }).map((s: AliasSuggestion) => ({
      term: s.term,
      kind: s.kind,
      isAmbiguous: s.isAmbiguous,
      contextTerms: s.contextTerms,
      negativeTerms: s.negativeTerms,
      enabled: s.enabled,
      source: "suggested" as const,
      reason: s.reason,
    }));
  }

  return (
    <>
      <StepHeader
        step={2}
        title="Keywords to listen for"
        description={
          <>
            We suggested these from what you entered. Ambiguous words (like a common English word) only count when one
            of their <span className="font-medium text-foreground">context terms</span> appears in the same post.
          </>
        }
      />
      <Card>
        <CardContent>
          <KeywordEditor productId={product.id} initial={initial} mode="onboarding" />
        </CardContent>
      </Card>
    </>
  );
}
