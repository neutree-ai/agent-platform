import { cn } from "@/lib/utils";

interface BreathingHaloProps {
  className?: string;
  size?: string;
}

export function BreathingHalo({ className, size = "h-40 w-40" }: BreathingHaloProps) {
  return (
    <output
      className={cn("flex h-full w-full items-center justify-center", className)}
      aria-live="polite"
      aria-busy="true"
    >
      <div
        aria-hidden
        className={cn("rounded-full bg-primary/30 blur-3xl animate-breathing-halo", size)}
      />
    </output>
  );
}
