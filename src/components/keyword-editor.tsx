"use client";

import { useActionState, useId, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Input } from "@/components/ui/primitives";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { saveAliasesAction } from "@/app/actions/product";
import { isAmbiguousCustomTerm, isBrandTerm, type AliasKind } from "@/lib/domain/aliases";
import { overAllowanceReason as overReason, type KeywordAllowance } from "@/lib/domain/keyword-allowance";
import { cn } from "@/lib/utils";

export interface EditableAlias {
  term: string;
  kind: AliasKind;
  isAmbiguous: boolean;
  contextTerms: string[];
  negativeTerms: string[];
  enabled: boolean;
  source: "suggested" | "user";
  reason?: string;
}

const KIND_LABEL: Record<AliasKind, string> = {
  exact_name: "Name",
  abbreviation: "Abbreviation",
  domain: "Domain",
  misspelling: "Variant",
  handle: "Handle",
  custom: "Custom",
};

function parseTerms(s: string) {
  return s.split(",").map((t) => t.trim()).filter((t) => t.length >= 2).slice(0, 20);
}

export function KeywordEditor({
  productId, initial, mode, allowance, productName,
}: { productId: string; initial: EditableAlias[]; mode: "onboarding" | "settings"; allowance?: KeywordAllowance; productName?: string }) {
  const [aliases, setAliases] = useState<EditableAlias[]>(initial);
  const [draft, setDraft] = useState("");
  const [state, action] = useActionState(saveAliasesAction, idle);
  const addId = useId();

  const update = (i: number, patch: Partial<EditableAlias>) =>
    setAliases((list) => list.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  const add = () => {
    const term = draft.trim();
    if (term.length < 2 || aliases.some((a) => a.term.toLowerCase() === term.toLowerCase())) return;
    const amb = isAmbiguousCustomTerm(term);
    const full = Boolean(allowance) && aliases.filter((a) => a.enabled).length >= allowance!.available;
    setAliases((l) => [
      ...l,
      {
        term, kind: "custom", isAmbiguous: amb, contextTerms: [], negativeTerms: [], enabled: !amb && !full, source: "user",
        reason: amb
          ? "Common word — counted only when a context term also appears. Untick “Needs context” if it's distinctive."
          : full ? overReason(allowance!) : undefined,
      },
    ]);
    setDraft("");
  };

  const payload = JSON.stringify(
    aliases.map(({ reason: _reason, ...a }) => a),
  );
  const enabledCount = aliases.filter((a) => a.enabled).length;
  const atLimit = Boolean(allowance) && enabledCount >= allowance!.available;
  const overLimit = Boolean(allowance) && enabledCount > allowance!.available;
  // One keyword for this product and it's the product name (always on): adding others could never switch them on.
  const hasBrand = productName !== undefined && aliases.some((a) => isBrandTerm(a.term, productName));
  const onlyBrand = Boolean(allowance) && allowance!.available <= 1 && hasBrand && aliases.every((a) => isBrandTerm(a.term, productName!) || !a.enabled);

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="aliases" value={payload} />
      <FormMessage state={state} />

      <ul className="grid gap-2" aria-label="Keywords">
        {aliases.length === 0 && (
          <li className="rounded-2xl border border-dashed p-5 text-center text-[13px] text-muted-foreground">No keywords yet. Add at least one below.</li>
        )}
        {aliases.map((a, i) => {
          const needsContext = a.isAmbiguous && a.contextTerms.length === 0;
          // The product name is always monitored: it can't be removed or switched off (only given context words).
          const brand = productName !== undefined && isBrandTerm(a.term, productName);
          // On a one-keyword plan only the product name can be on; the rest stay saved (off) but aren't shown.
          if (onlyBrand && !brand) return null;
          return (
            <li key={a.term} className={cn("grid gap-2.5 rounded-2xl border p-3.5 transition-colors",
              a.enabled ? "border-foreground/[0.12] bg-foreground/[0.04]" : "border-foreground/[0.06] bg-transparent")}>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--primary)]"
                    checked={a.enabled}
                    disabled={needsContext || (!a.enabled && atLimit) || (brand && a.enabled)}
                    title={!a.enabled && atLimit && allowance ? overReason(allowance) : undefined}
                    onChange={(e) => update(i, { enabled: e.target.checked })}
                    aria-label={`Listen for ${a.term}`}
                  />
                  <span className={cn("truncate text-[14px] font-medium", !a.enabled && "font-normal text-muted-foreground")}>{a.term}</span>
                </label>
                <Badge>{KIND_LABEL[a.kind]}</Badge>
                {brand && <Badge tone="info">Always monitored</Badge>}
                {a.isAmbiguous && (
                  <Badge tone="warning">
                    <AlertTriangle className="size-3" aria-hidden /> Ambiguous
                  </Badge>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-[var(--primary)]"
                      checked={a.isAmbiguous}
                      onChange={(e) =>
                        update(i, {
                          isAmbiguous: e.target.checked,
                          // The product name is on whenever it can be.
                          enabled: e.target.checked && a.contextTerms.length === 0 ? false : brand ? true : a.enabled,
                        })
                      }
                    />
                    Needs context
                  </label>
                  {/* The product name can't be removed, so it gets no remove button at all. */}
                  {!brand && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${a.term}`}
                      onClick={() => setAliases((l) => l.filter((_, j) => j !== i))}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>
              {needsContext ? (
                <p className="text-xs text-muted-foreground">
                  Off until you add a context word below{brand ? "" : ", or untick “Needs context” if the word is distinctive"}. A mention then counts only when one of those words also appears.
                </p>
              ) : a.reason ? <p className="text-xs text-muted-foreground">{a.reason}</p> : null}
              {a.isAmbiguous && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs">
                    <span className="text-muted-foreground">Context terms (comma-separated, at least one)</span>
                    <Input
                      defaultValue={a.contextTerms.join(", ")}
                      placeholder="issue tracker, sprint, linear.app"
                      aria-invalid={needsContext || undefined}
                      // Commit on every keystroke (not blur) so the enable checkbox is never stale:
                      // a blur-then-click sequence would otherwise auto-enable and immediately re-disable.
                      onChange={(e) => {
                        const terms = parseTerms(e.target.value);
                        update(i, { contextTerms: terms, enabled: terms.length === 0 ? false : a.enabled || a.contextTerms.length === 0 });
                      }}
                    />
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="text-muted-foreground">Exclude when these appear (optional)</span>
                    <Input
                      defaultValue={a.negativeTerms.join(", ")}
                      placeholder="algebra, regression"
                      onChange={(e) => update(i, { negativeTerms: parseTerms(e.target.value) })}
                    />
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {onlyBrand ? (
        <p className="rounded-2xl border border-dashed p-4 text-[13px] text-muted-foreground">
          Your {allowance!.planName} plan includes {allowance!.max === 1 ? "one keyword" : `${allowance!.max} keywords`}, and your product name
          uses it: every mention of {productName} is found. To listen for more names, handles or misspellings,{" "}
          <a href="/settings/billing" className="font-medium text-foreground underline underline-offset-2">see the plans</a>.
        </p>
      ) : (
      <div className="flex gap-2">
        <label htmlFor={addId} className="sr-only">Add a keyword</label>
        <Input
          id={addId}
          value={draft}
          maxLength={100}
          placeholder="Add a keyword, handle or misspelling"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={add}>
          <Plus /> Add
        </Button>
      </div>
      )}

      {overLimit && allowance && (
        <p className="text-xs text-negative" role="alert">
          {enabledCount} keywords are on, but your {allowance.planName} plan allows {allowance.available} for this product. Turn some off to save.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground/[0.06] pt-4">
        <div className="flex items-center gap-3">
          {allowance && allowance.available > 0 && (
            <span className="flex gap-1" aria-hidden>
              {Array.from({ length: Math.min(allowance.available, 10) }, (_, k) => (
                <span key={k} className={cn("h-1.5 w-5 rounded-full", k < enabledCount ? "bg-foreground" : "bg-foreground/[0.12]")} />
              ))}
            </span>
          )}
          <p className="text-xs text-muted-foreground tabular">
            {enabledCount} of {onlyBrand ? aliases.filter((x) => isBrandTerm(x.term, productName!)).length : aliases.length} keywords active
            {allowance && ` · plan allows ${allowance.available}${allowance.available !== allowance.max ? ` here (${allowance.max} per workspace)` : ""}`}
          </p>
        </div>
        <SubmitButton disabled={enabledCount === 0 || overLimit} pendingLabel="Saving…">
          {mode === "onboarding" ? "Save and continue" : "Save keywords"}
        </SubmitButton>
      </div>
    </form>
  );
}
