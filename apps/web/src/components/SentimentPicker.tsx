"use client";
import { Check, ChevronDown } from "lucide-react";
import { SENTIMENT_VALUES } from "@echoline/core";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Four semantic stages (neutral -> working -> won/lost) spread across eight
// values so adjacent stages stay visually distinct at a glance down a long
// column, not just by in/success/destructive bucket.
const SENTIMENT_META: Record<string, { dot: string; text: string; bg: string; border: string }> = {
  "Not Contacted": { dot: "bg-slate-400", text: "text-slate-600", bg: "bg-slate-50", border: "border-slate-200" },
  Contacted: { dot: "bg-sky-500", text: "text-sky-700", bg: "bg-sky-50", border: "border-sky-200" },
  "Cold Call Done": { dot: "bg-indigo-500", text: "text-indigo-700", bg: "bg-indigo-50", border: "border-indigo-200" },
  Interested: { dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  "Offer Made": { dot: "bg-orange-500", text: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200" },
  Converted: { dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  "Not Interested": { dot: "bg-rose-400", text: "text-rose-600", bg: "bg-rose-50", border: "border-rose-200" },
  Lost: { dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50", border: "border-red-200" },
};

interface SentimentPickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** Colored pill + checklist dropdown for the sales-pipeline "sentiment"
 * stage — replaces a plain native <select> so the current stage reads at a
 * glance (color + dot) instead of requiring the cell to be opened to see it. */
export function SentimentPicker({ value, onChange, disabled }: SentimentPickerProps) {
  const meta = SENTIMENT_META[value] ?? SENTIMENT_META["Not Contacted"];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex h-7 w-[158px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50",
            meta.bg,
            meta.text,
            meta.border
          )}
        >
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
          <span className="flex-1 truncate text-left">{value}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {SENTIMENT_VALUES.map((s) => {
          const m = SENTIMENT_META[s];
          return (
            <DropdownMenuItem key={s} onSelect={() => onChange(s)} className="gap-2">
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", m.dot)} />
              <span className="flex-1">{s}</span>
              {s === value && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
