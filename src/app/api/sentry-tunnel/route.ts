// Passes the browser's error reports on to Sentry (src/lib/sentry.ts). Forwards only envelopes for Heardex's own DSN,
// and not the request's headers or cookies.
export { POST } from "@sentry/nextjs/tunnel";
