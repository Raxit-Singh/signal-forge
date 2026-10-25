"use client";

import { Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { PlatformMark } from "@/components/brand-logo";
import { idle } from "@/lib/action-state";
import { createProductAction, updateProductAction } from "@/app/actions/product";

export interface ProductValues {
  id: string;
  name: string;
  website_url: string | null;
  description: string | null;
  category: string | null;
  target_audience: string | null;
  app_store_url: string | null;
  play_store_url: string | null;
  github_repo: string | null;
}

export function ProductForm({ mode, product }: { mode: "create" | "edit"; product?: ProductValues }) {
  const [state, action] = useFormAction(mode === "create" ? createProductAction : updateProductAction, idle);
  const v = (k: keyof ProductValues) => product?.[k] ?? undefined;
  return (
    <form action={action} className="grid gap-5" noValidate>
      {product && <input type="hidden" name="productId" value={product.id} />}
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Product name" required maxLength={80} defaultValue={v("name")} state={state}
          autoFocus={mode === "create"} placeholder="FocusFlow" />
        <Field name="websiteUrl" label="Website" optional defaultValue={v("website_url")} state={state}
          placeholder="focusflow.app" inputMode="url" />
      </div>

      <Field name="description" label="What does it do?" optional multiline rows={3} maxLength={2000}
        defaultValue={v("description")} state={state}
        hint="One or two sentences. Used to tell real mentions apart from unrelated ones." />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="category" label="Category" optional maxLength={80} defaultValue={v("category")} state={state}
          placeholder="Developer tools, productivity…" />
        <Field name="targetAudience" label="Target audience" optional maxLength={500} defaultValue={v("target_audience")}
          state={state} placeholder="Freelance developers" />
      </div>

      <fieldset className="grid gap-4 rounded-2xl border border-foreground/[0.08] bg-foreground/[0.02] p-4">
        <legend className="flex items-center gap-2 px-1 text-[13px] font-medium">
          <span className="flex -space-x-1.5" aria-hidden>
            {["github", "app_store", "google_play"].map((s) => <PlatformMark key={s} source={s} size={22} className="bg-background" />)}
          </span>
          Listings &amp; code <span className="font-normal text-muted-foreground">(optional)</span>
        </legend>
        <Field name="githubRepo" label="GitHub repository" optional defaultValue={v("github_repo")} state={state}
          placeholder="owner/repo or https://github.com/owner/repo" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="appStoreUrl" label="App Store URL" optional defaultValue={v("app_store_url")} state={state}
            placeholder="https://apps.apple.com/…/id123456789" inputMode="url" />
          <Field name="playStoreUrl" label="Google Play URL" optional defaultValue={v("play_store_url")} state={state}
            placeholder="https://play.google.com/store/apps/details?id=…" inputMode="url" />
        </div>
        <p className="text-xs text-muted-foreground">
          Listing links are stored only. Reading reviews needs a developer-account connection, set up later.
        </p>
      </fieldset>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">{mode === "create" ? "Continue" : "Save changes"}</SubmitButton>
      </div>
    </form>
  );
}
