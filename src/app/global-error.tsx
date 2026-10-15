"use client";

// Last-resort boundary for errors in the root layout itself.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100dvh", margin: 0 }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 18 }}>SignalForge hit an unexpected error.</h1>
          <button onClick={reset} style={{ marginTop: 12, padding: "6px 12px" }}>Reload</button>
        </div>
      </body>
    </html>
  );
}
