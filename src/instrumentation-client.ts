import * as Sentry from "@sentry/nextjs";
import { CONSENT_COOKIE, parseConsent } from "@/lib/consent";
import { SENTRY_TUNNEL, sentryOptions } from "@/lib/sentry";

// Browser errors and page timings, sent to Sentry through Heardex's own server (src/lib/sentry.ts).

// A replay of the moments before an error, only for visitors who chose "Accept all" in the cookie banner. Every text,
// typed value and image is masked: it shows where people clicked, not what they read or typed. Nothing is recorded
// unless an error happens.
const replay = () =>
  Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true });
const acceptedAll = () =>
  parseConsent(document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`))?.[1]) === "all";

Sentry.init({
  ...sentryOptions,
  tunnel: SENTRY_TUNNEL,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1,
  // No page-view sessions: errors, timings and (with consent) error replays only.
  integrations: (defaults) => [
    ...defaults.filter((i) => i.name !== "BrowserSession"),
    ...(acceptedAll() ? [replay()] : []),
  ],
});

// The cookie banner (src/components/cookie-banner.tsx) announces a new choice: start replays after "Accept all", stop
// them after "Essential only".
addEventListener("hx:consent", () => {
  const client = Sentry.getClient();
  const running = client?.getIntegrationByName<ReturnType<typeof Sentry.replayIntegration>>("Replay");
  if (acceptedAll()) {
    if (!running) Sentry.addIntegration(replay());
  } else if (running) {
    void running.stop();
  }
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
