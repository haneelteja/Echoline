import * as React from "react";
import { cn } from "@/lib/utils";

const ACCENT = {
  purple: { border: "border-l-purple-500", icon: "text-purple-200", value: "text-purple-700" },
  rose: { border: "border-l-rose-500", icon: "text-rose-200", value: "text-rose-700" },
  teal: { border: "border-l-teal-500", icon: "text-teal-200", value: "text-teal-700" },
  sky: { border: "border-l-sky-500", icon: "text-sky-200", value: "text-sky-700" },
  emerald: { border: "border-l-emerald-500", icon: "text-emerald-200", value: "text-emerald-700" },
  amber: { border: "border-l-amber-500", icon: "text-amber-200", value: "text-amber-700" },
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

/** Left-accent stat tile — white card, colored left border, large pale icon,
 * bold colored value. Matches the Sales Operations Portal's KPI tile recipe. */
export function KpiCard({ label, value, sub, icon: Icon, accent, className }: KpiCardProps) {
  const a = ACCENT[accent];
  return (
    <div
      className={cn(
        "flex min-h-[88px] items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm transition-all hover:shadow-md border-l-4",
        a.border,
        className
      )}
    >
      <Icon className={cn("h-9 w-9 shrink-0", a.icon)} />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase leading-none tracking-wide text-gray-400">{label}</p>
        <p className={cn("mt-1 text-xl font-bold leading-none tabular-nums", a.value)}>{value}</p>
        {sub && <p className="mt-0.5 text-[10px] text-gray-400">{sub}</p>}
      </div>
    </div>
  );
}
