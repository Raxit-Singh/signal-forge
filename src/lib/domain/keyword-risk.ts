// Broad-keyword detection (pure). Warns — never rejects or rewrites — when a
// keyword is likely to match a lot of conversation: unrelated meanings (ambiguity)
// and/or sheer volume. Customers choose their keywords; this only makes the
// consequence for their mention allowance visible before they commit.

import { isAmbiguousTerm, splitWords } from "./aliases.ts";

/**
 * Names discussed at very high volume across social platforms (companies, people,
 * products, generic tech terms). A heuristic list, not a measurement: it triggers
 * a warning, never an estimate.
 */
const HIGH_VOLUME = new Set(
  `ai ml llm gpt chatgpt openai claude gemini copilot anthropic apple iphone ipad mac macbook google android
  youtube microsoft windows azure amazon aws alexa meta facebook instagram whatsapp threads x twitter tiktok
  netflix spotify tesla spacex starlink elon musk elon-musk nvidia intel amd samsung sony nintendo xbox
  playstation uber airbnb notion cursor slack zoom figma canva shopify stripe paypal bitcoin ethereum crypto
  nft linux python javascript react docker kubernetes github reddit discord telegram`
    .split(/\s+/).filter(Boolean),
);
const HIGH_VOLUME_PHRASES = new Set(["elon musk", "artificial intelligence", "machine learning", "open ai", "space x"]);

export type BroadReason = "short" | "ambiguous" | "high_volume";

export interface KeywordRisk {
  term: string;
  reasons: BroadReason[];
  /** Plain-language explanation shown next to the keyword. */
  message: string;
  /** What would make it more precise, using the product's own facts (never applied automatically). */
  suggestion: string | null;
}

export function assessKeywordRisk(term: string, product: { name?: string | null; domain?: string | null; category?: string | null; contextTerms?: string[] } = {}): KeywordRisk | null {
  const t = term.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  const words = splitWords(t).map((w) => w.toLowerCase());
  const reasons: BroadReason[] = [];
  if (lower.replace(/[^a-z0-9]/g, "").length <= 3 && !lower.includes(".")) reasons.push("short");
  if (isAmbiguousTerm(t) && !reasons.includes("short")) reasons.push("ambiguous");
  if (HIGH_VOLUME.has(lower) || HIGH_VOLUME_PHRASES.has(lower) || (words.length === 1 && HIGH_VOLUME.has(words[0]!))) reasons.push("high_volume");
  if (reasons.length === 0) return null;

  const parts: string[] = [];
  if (reasons.includes("short")) parts.push("very short, so it matches many unrelated words and acronyms");
  if (reasons.includes("ambiguous")) parts.push("also an everyday word or another product's name, so it may match unrelated discussions");
  if (reasons.includes("high_volume")) parts.push("very widely discussed, so mention volume may be high");
  const message = `“${t}” is ${parts.join("; ")}. It may use your monthly mention allowance quickly; relevance filtering removes unrelated results it can recognise.`;

  const ideas = [product.domain, product.category, product.name && product.name.toLowerCase() !== lower ? product.name : null]
    .filter((x): x is string => Boolean(x && x.trim()));
  const hasContext = (product.contextTerms ?? []).length > 0;
  const suggestion = hasContext
    ? null
    : ideas.length
      ? `Consider adding context words such as ${ideas.slice(0, 2).map((x) => `“${x}”`).join(" or ")} so only matching discussions count.`
      : "Consider adding context words (your category or domain) so only matching discussions count.";
  return { term: t, reasons, message, suggestion };
}

/** Keywords among `terms` that are broad (for warnings that list them). */
export function broadKeywords(terms: Array<{ term: string; contextTerms?: string[] }>, product: { name?: string | null; domain?: string | null; category?: string | null } = {}): KeywordRisk[] {
  return terms.map((k) => assessKeywordRisk(k.term, { ...product, contextTerms: k.contextTerms })).filter((r): r is KeywordRisk => r !== null);
}
