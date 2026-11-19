import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry";

Sentry.init({
  ...sentryOptions,
  // The server's own warnings and errors, next to the crashes they explain.
  integrations: [Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] })],
});
