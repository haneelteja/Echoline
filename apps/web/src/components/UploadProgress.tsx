"use client";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import type { UploadItem } from "@/lib/useKbAssets";
import { cn } from "@/lib/utils";

/** Per-file upload status list — shown while useKbAssets().uploadFiles() is
 * in flight, in both the Knowledge base page and the template editor's
 * AssetPicker. Each file gets its own row so a slow or failed file among a
 * batch is visible instead of one opaque "Uploading…" spinner. */
export function UploadProgress({ items }: { items: UploadItem[] }) {
  if (!items.length) return null;
  const done = items.filter((i) => i.status === "done").length;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Uploading {done}/{items.length}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
        />
      </div>
      <ul className="mt-3 flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={`${item.name}-${i}`} className="flex items-center gap-2 text-sm">
            {item.status === "pending" && <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-muted-foreground/40" />}
            {item.status === "uploading" && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
            {item.status === "done" && <Check className="h-3.5 w-3.5 shrink-0 text-success" />}
            {item.status === "error" && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />}
            <span
              className={cn(
                "truncate",
                item.status === "pending" && "text-muted-foreground",
                item.status === "error" && "text-destructive"
              )}
              title={item.errorMessage ?? item.name}
            >
              {item.name}
            </span>
            {item.status === "error" && item.errorMessage && (
              <span className="truncate text-xs text-destructive/80">— {item.errorMessage}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
