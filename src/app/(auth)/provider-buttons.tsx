import { SubmitButton } from "@/components/ui/form";
import { OAUTH_PROVIDERS, PROVIDER_LABEL, type OAuthProvider, type ProviderAvailability } from "@/lib/auth/flow";
import { signInWithProviderAction } from "./actions";

const ICONS: Record<OAuthProvider, React.ReactNode> = {
  google: (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9l3.7-2.8z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-current">
      <path d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5z" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-current">
      <path d="M17.8 2.5h3.3l-7.2 8.2 8.5 10.8h-6.6l-5.2-6.6-5.9 6.6H1.4l7.7-8.8L1 2.5h6.8l4.7 6 5.3-6zm-1.2 17h1.8L7.5 4.3H5.6l11 15.2z" />
    </svg>
  ),
};

/**
 * One button per social provider that is switched on in Supabase Auth. Providers
 * that are off are not shown at all, so nobody lands on a provider error page.
 */
export function ProviderButtons({ providers, next }: { providers: ProviderAvailability; next?: string }) {
  const enabled = OAUTH_PROVIDERS.filter((p) => providers[p]);
  if (enabled.length === 0) {
    return process.env.NODE_ENV === "development" ? (
      <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground" data-testid="providers-dev-note">
        Development: Google and GitHub buttons appear once those providers are switched on in Supabase. Run{" "}
        <code className="font-mono">npm run auth:check</code> to see what&apos;s missing.
      </p>
    ) : null;
  }
  return (
    <>
      <div className="grid gap-2" aria-label="Social sign-in">
        {enabled.map((p) => (
          <form key={p} action={signInWithProviderAction}>
            <input type="hidden" name="provider" value={p} />
            {next && <input type="hidden" name="next" value={next} />}
            <SubmitButton variant="secondary" className="w-full" pendingLabel={`Opening ${PROVIDER_LABEL[p]}…`}>
              {ICONS[p]}
              Continue with {PROVIDER_LABEL[p]}
            </SubmitButton>
          </form>
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> Or continue with email <span className="h-px flex-1 bg-border" />
      </div>
    </>
  );
}
