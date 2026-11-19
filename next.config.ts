import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // Server actions reject cross-origin POSTs by default (CSRF protection).
      // Add your production origin here only if it differs from the host header.
      bodySizeLimit: "256kb",
    },
  },
  async redirects() {
    // Heardex for Claude became Heardex MCP (it works in ChatGPT, Cursor and VS Code too).
    return [
      { source: "/product/claude", destination: "/product/mcp", permanent: true },
      { source: "/docs/claude", destination: "/docs/mcp", permanent: true },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Error reporting (src/lib/sentry.ts). With SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT set on Vercel, the build
// uploads source maps so reports show the real file and line; without them it builds as normal and uploads nothing.
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  widenClientFileUpload: true,
  sourcemaps: { disable: !uploadSourceMaps },
});
