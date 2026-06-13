import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-[3px] focus:ring-ring/25",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        success: "border-transparent bg-success text-success-foreground",
        warning: "border-transparent bg-warning text-warning-foreground",
        // Soft tints — muted backgrounds for status chips that need to read
        // as distinct but not loud against soft card chrome.
        "success-soft": "bg-success/15 text-success border-success/30",
        "destructive-soft": "bg-destructive/10 text-destructive border-destructive/20",
        "accent-soft": "bg-accent/40 text-accent-foreground border-accent/40",
        "info-soft": "bg-info/15 text-info border-info/30",
        "warning-soft": "bg-warning/15 text-warning border-warning/30",
        "muted-soft": "bg-muted text-muted-foreground border-border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
