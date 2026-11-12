"use client";
import { useEffect } from "react";
import { logError } from "@/lib/logger";

/** Last resort: a crash in the ROOT layout itself (outside every other
 * boundary, before any dashboard shell exists to render into). Must render
 * its own <html><body> — this fully replaces the root layout, it doesn't
 * nest inside it. (dashboard)/error.tsx handles the far more common case
 * of a crash inside a dashboard page; this only fires above that. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logError({ source: "runtime", module: "GlobalErrorBoundary", message: error.message, error });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 12, fontFamily: "system-ui" }}>
        <h1>Something went wrong.</h1>
        <p>Please refresh the page. If this keeps happening, contact support.</p>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
