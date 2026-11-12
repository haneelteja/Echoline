import * as React from "react";
import { cn } from "@/lib/utils";

// Named for the hue each one actually renders — "purple" and "rose" used to
// exist here but resolved to plain cyan (identical to "sky") and red
// (identical to "red" in all but name) respectively; the palette has no
// real purple or rose hue, so those were a naming lie, not a design choice.
const ACCENT = {
  sky: { border: "border-l-primary", icon: "text-primary/25", value: "text-primary" },
  red: { border: "border-l-destructive", icon: "text-destructive/25", value: "text-destructive" },
  teal: { border: "border-l-[var(--wa)]", icon: "text-[var(--wa)]/25", value: "text-[var(--wa)]" },
  emerald: { border: "border-l-[var(--ok)]", icon: "text-[var(--ok)]/25", value: "text-[var(--ok)]" },
  amber: { border: "border-l-[var(--warn)]", icon: "text-[var(--warn)]/25", value: "text-[var(--warn)]" },
} as const;

export type KpiAccent = keyof typeof ACCENT;

export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  accent: KpiAccent;
  className?: string;
}

/** Left-accent stat tile — card, colored left border, large pale icon, bold colored value. */
export function KpiCard({ label, value, sub, icon: Icon, accent, className }: KpiCardProps) {
  const a = ACCENT[accent];
  return (
    <div className={cn("panel flex min-h-[88px] items-center gap-3 border-l-4 p-3", a.border, className)}>
      <Icon className={cn("h-9 w-9 shrink-0", a.icon)} />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase leading-none tracking-wide text-muted-foreground">{label}</p>
        <p className={cn("mt-1 text-xl font-bold leading-none tabular-nums", a.value)}>{value}</p>
        {sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}
