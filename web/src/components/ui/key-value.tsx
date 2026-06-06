import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Definition-list primitives for compact "label : value" detail views
 * (resource cards, template config panel, info popovers, etc.).
 *
 * Compose inside a CSS grid `grid-cols-[auto_1fr]` so the key column
 * auto-sizes to its widest sibling per group — no hardcoded widths,
 * no truncation when labels vary in length.
 *
 * Example:
 * ```tsx
 * <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-xs">
 *   <KVKey>Channel</KVKey>
 *   <KVValue>#general</KVValue>
 *   <KVKey>ID</KVKey>
 *   <KVValue className="font-mono">C0XXXXXXXXX</KVValue>
 * </dl>
 * ```
 */
export function KVKey({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <dt className={cn("text-tiny uppercase tracking-wide text-muted-foreground/60", className)}>
      {children}
    </dt>
  );
}

export function KVValue({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <dd className={cn("flex min-w-0 items-center text-foreground", className)}>{children}</dd>;
}
