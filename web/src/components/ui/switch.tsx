import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

/**
 * Toggle styled to read like a macOS control: tighter track proportions,
 * a quiet inset shadow on the off-state for depth, and a thumb whose
 * shadow + hairline ring catches light without looking inflated.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-[1.375rem] w-9 shrink-0 cursor-pointer items-center rounded-full",
      "border-2 border-transparent transition-colors duration-200",
      "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-primary",
      "data-[state=unchecked]:bg-foreground/[0.15]",
      "data-[state=unchecked]:shadow-[inset_0_1px_2px_oklch(var(--foreground)/0.08)]",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-[1.125rem] w-[1.125rem] rounded-full bg-background",
        "shadow-[0_1px_2px_oklch(var(--foreground)/0.18),0_0_0_0.5px_oklch(var(--foreground)/0.06)]",
        "transition-transform duration-200 ease-out",
        "data-[state=checked]:translate-x-[0.875rem] data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
