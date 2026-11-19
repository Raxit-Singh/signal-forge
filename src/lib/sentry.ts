// Error reporting (Sentry), shared by the browser, server and edge set-ups (src/instrumentation*.ts,
// src/sentry.*.config.ts).
//
// - Errors: always, with as little about the visitor as possible: no cookies, headers, request bodies, query strings,
//   user details or local variables (those can hold sign-in tokens or keys).
// - Tracing: how long pages and requests take, for 1 in 10 in production (every one locally).
// - Logs: the server's own warnings and errors.
// - Session Replay: browser only, only for visitors who chose "Accept all" (src/lib/consent.ts), only around an error,
//   with every text, input and image masked (src/instrumentation-client.ts).
//
// Off unless NEXT_PUBLIC_SENTRY_DSN is set. In development it stays off unless NEXT_PUBLIC_SENTRY_DEV=1.

import type { NodeOptions } from "@sentry/nextjs";

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const production = process.env.NODE_ENV === "production";

/** Browser errors go to Heardex's own server first (src/app/api/sentry-tunnel), so ad-blockers don't drop them. */
export const SENTRY_TUNNEL = "/api/sentry-tunnel";

export const sentryOptions: NodeOptions = {
  dsn: SENTRY_DSN,
  enabled: Boolean(SENTRY_DSN) && (production || process.env.NEXT_PUBLIC_SENTRY_DEV === "1"),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: production ? 0.1 : 1,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
    genAI: { inputs: false, outputs: false },
    mcp: { inputs: false, outputs: false },
    graphQL: { document: false, variables: false },
  },
};
