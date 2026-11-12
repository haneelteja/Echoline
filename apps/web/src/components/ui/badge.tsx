import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold transition-colors", {
  variants: {
    variant: {
      // -ink text variants, not the plain accent — a saturated token on a
      // 15%-tint of itself fails WCAG AA (computed ~2.2-3.1:1 against
      // 4.5:1); -ink is the same hue darkened enough to clear it, see
      // globals.css's --email-ink/--wa-ink/--bad-ink for the actual numbers.
      default: "border-transparent bg-primary/15 text-primary-ink",
      secondary: "border-transparent bg-secondary text-secondary-foreground",
      success: "border-transparent bg-success/15 text-success-ink",
      destructive: "border-transparent bg-destructive/15 text-destructive-ink",
      outline: "border-border text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
