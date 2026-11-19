"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Last-resort boundary for errors in the root layout itself. Errors from the server (they carry a digest) were already
// reported there (src/instrumentation.ts); browser errors are reported here.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (!error.digest) Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100dvh", margin: 0 }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 18 }}>Heardex hit an unexpected error.</h1>
          <button onClick={reset} style={{ marginTop: 12, padding: "6px 12px" }}>Reload</button>
        </div>
      </body>
    </html>
  );
}
