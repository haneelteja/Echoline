"use client";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { logError } from "@/lib/logger";
import { Button } from "@/components/ui/button";

/** Catches a render-time throw from any dashboard page (contacts, sequence,
 * sources, …) or a component it renders — without losing the nav shell,
 * since (dashboard)/layout.tsx itself sits above this boundary, not inside
 * it. Before this existed, any such crash blanked the whole app. */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logError({ source: "component", module: "DashboardErrorBoundary", message: error.message, error });
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <h2 className="font-display text-lg font-semibold text-foreground">Something went wrong.</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        This page hit an unexpected error. Your other data is safe — try again, or navigate to another page.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
