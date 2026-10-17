"use client";

import { useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { AI_PROVIDERS, type ByokProvider } from "@/lib/domain/ai-providers";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { deleteAiKeyAction, saveAiKeyAction, setDefaultAiProviderAction, verifyAiKeyAction } from "@/app/actions/ai";
import { ActionForm } from "@/components/ai/action-form";
import { cn } from "@/lib/utils";

export interface ConnectionView {
  provider: string;
  keyHint: string | null;
  status: string;
  isDefault: boolean;
  model?: string | null;
  lastError?: string | null;
}

const BYOK = AI_PROVIDERS.filter((p) => p.provider !== "signalforge");

export function AiProviderPanel({
  workspaceId, connections, returnTo, canManage,
}: { workspaceId: string; connections: ConnectionView[]; returnTo: string; canManage: boolean }) {
  const [provider, setProvider] = useState<ByokProvider>("anthropic");
  const [state, action] = useFormAction(saveAiKeyAction, idle);
  const [delState, delAction] = useFormAction(deleteAiKeyAction, idle);
  const info = BYOK.find((p) => p.provider === provider)!;
  const existing = connections.find((c) => c.provider === provider);

  return (
    <div className="grid gap-4">
      {connections.length > 0 && (
        <ul className="divide-y rounded-md border" aria-label="Connected AI providers">
          {connections.map((c) => (
            <li key={c.provider} className="flex flex-wrap items-center gap-2 p-3 text-[13px]">
              <span className="font-medium">{AI_PROVIDERS.find((p) => p.provider === c.provider)?.name ?? c.provider}</span>
              {c.keyHint && <span className="font-mono text-xs text-muted-foreground">…{c.keyHint}</span>}
              <Badge tone={c.status === "valid" ? "positive" : c.status === "invalid" ? "negative" : "neutral"}>
                {c.status === "unverified" ? "Not yet verified" : c.status}
              </Badge>
              {c.model && c.model !== "test-classifier" && <span className="font-mono text-xs text-muted-foreground">{c.model}</span>}
              {c.model === "test-classifier" && <Badge tone="warning">Test classifier</Badge>}
              {c.isDefault && <Badge tone="accent">In use</Badge>}
              {c.lastError && c.status !== "valid" && <span className="basis-full text-xs text-negative">{c.lastError}</span>}
              {canManage && c.provider !== "signalforge" && (
                <ActionForm action={verifyAiKeyAction} fields={{ workspaceId, provider: c.provider }} label="Verify" pendingLabel="Checking…" variant="ghost" className="ml-auto" />
              )}
              {canManage && !c.isDefault && (
                <ActionForm action={setDefaultAiProviderAction} fields={{ workspaceId, provider: c.provider }} label="Use this" variant="ghost" className={c.provider === "signalforge" ? "ml-auto" : undefined} />
              )}
              {canManage && (
                <form action={delAction} className={c.provider === "signalforge" && c.isDefault ? "ml-auto" : undefined}>
                  <input type="hidden" name="workspaceId" value={workspaceId} />
                  <input type="hidden" name="provider" value={c.provider} />
                  <SubmitButton variant="ghost" size="sm" pendingLabel="Removing…">Remove</SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      <FormMessage state={delState} />

      {canManage && (
        <form action={action} className="grid gap-4 rounded-md border p-4" noValidate>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="provider" value={provider} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Bring your own API key</span>
            <div role="radiogroup" aria-label="Provider" className="flex flex-wrap gap-1.5">
              {BYOK.map((p) => (
                <Button
                  key={p.provider}
                  type="button"
                  role="radio"
                  aria-checked={provider === p.provider}
                  variant="secondary"
                  size="sm"
                  className={cn(provider === p.provider && "border-primary bg-accent text-accent-foreground")}
                  onClick={() => setProvider(p.provider as ByokProvider)}
                >
                  {p.name}
                </Button>
              ))}
            </div>
          </div>
          <FormMessage state={state} />
          <Field
            key={provider}
            name="apiKey"
            label={`${info.name} API key`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={existing ? `Replace key ending …${existing.keyHint}` : info.keyExample}
            state={state}
            hint={
              <>
                Create one at{" "}
                <a href={info.keyUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 underline underline-offset-2">
                  {new URL(info.keyUrl!).hostname} <ExternalLink className="size-3" aria-hidden />
                </a>
                . A ChatGPT, Claude or Gemini app subscription does not include API access — API usage is billed separately by the provider.
              </>
            }
          />
          {provider !== "anthropic" && (
            <Field
              key={`${provider}-model`}
              name="model"
              label="Model"
              autoComplete="off"
              spellCheck={false}
              defaultValue={existing?.model ?? ""}
              placeholder={provider === "openai" ? "model id from your OpenAI account" : "model id from Google AI Studio"}
              state={state}
              hint="Used for classification and analyses. SignalForge checks that your key can use it; usage is billed by your provider at its prices (we can't estimate them, so usage is shown in tokens)."
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" aria-hidden />
              Encrypted before storage. Never shown again or sent to your browser.
            </p>
            <SubmitButton pendingLabel="Saving…">{existing ? "Replace key" : "Save key"}</SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
