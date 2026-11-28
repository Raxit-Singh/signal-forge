import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { contextSuggestions, ensureBrandTerm, suggestAliases, type AliasSuggestion } from "@/lib/domain/aliases";
import { normalizeWebsiteUrl } from "@/lib/domain/urls";
import { Card, CardContent } from "@/components/ui/primitives";
import { KeywordEditor, type EditableAlias } from "@/components/keyword-editor";
import { fitSuggestionsToAllowance } from "@/lib/domain/keyword-allowance";
import { getKeywordSlots } from "@/lib/server/session";
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

  const site = product.website_url ? normalizeWebsiteUrl(product.website_url) : null;
  const domain = site?.ok ? site.value.domain : null;
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
    initial = suggestAliases({
      name: product.name,
      websiteDomain: domain,
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
  const allowance = await getKeywordSlots(product.workspace_id, product.id);
  if (!saved || saved.length === 0) initial = fitSuggestionsToAllowance(initial, allowance);

  return (
    <>
      <StepHeader
        step={2}
        title="Keywords to listen for"
        description={
          <>
            Heardex collects posts that contain one of these words. We started with your product name, which is always on.
            You can add other names people use for it, like a short name, a handle or a common misspelling.
          </>
        }
      />
      <Card>
        <CardContent>
          <KeywordEditor productId={product.id} initial={ensureBrandTerm(initial, product.name).aliases} mode="onboarding" allowance={allowance} productName={product.name}
            contextSuggestions={contextSuggestions({ name: product.name, websiteDomain: domain, category: product.category, description: product.description })} />
        </CardContent>
      </Card>
    </>
  );
}
