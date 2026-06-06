import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional leading icon. */
  icon?: LucideIcon;
  /** Optional trailing count (badge-like number, e.g., filter buckets). */
  count?: number;
  /**
   * When true, the visible label is suppressed and the icon stands alone;
   * `label` is moved to `aria-label` / `title` for accessibility. Only
   * meaningful when `icon` is also set. Use for tight headers where two
   * unambiguous glyphs (e.g., grid vs list) are clearer than text.
   */
  iconOnly?: boolean;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (next: T) => void;
  options: SegmentedOption<T>[];
  /**
   * Visual silhouette:
   *   - 'pill' — fully rounded, suited for filter rows where the control
   *     reads as a chip strip (e.g. "All / Private / Team / Public").
   *   - 'box'  — rounded-lg, suited for in-form choices (e.g. "Custom /
   *     SSH Key" preset toggle).
   */
  variant?: "pill" | "box";
  /** Track height. `sm` = h-6 (filters), `md` = h-7 (form inputs). */
  size?: "sm" | "md";
  /**
   * ARIA semantics:
   *   - 'tabs'  — role=tablist + tab + aria-selected. Use when the control
   *     filters or switches a sibling content view.
   *   - 'group' — aria-pressed buttons. Use when the choice is a form
   *     field value (the chosen option doesn't switch surrounding UI on
   *     its own — it's just data).
   * Default: 'group'.
   */
  mode?: "tabs" | "group";
  /** Optional accessible label, mainly for `mode="tabs"`. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Mutually-exclusive selector. Single source of truth for compact
 * pill/segmented controls across filters and forms — replaces the
 * ad-hoc rolls in ResourceFilterTabs and CredentialFormFields.
 *
 * Use shadcn `Tabs` (components/ui/tabs.tsx) instead when you also need
 * `TabsContent` panels with Radix-managed roving focus / keyboard nav
 * across mounted-but-hidden content.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  variant = "pill",
  size = "sm",
  mode = "group",
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const trackRadius = variant === "pill" ? "rounded-full" : "rounded-lg";
  const itemRadius = variant === "pill" ? "rounded-full" : "rounded-md";
  const itemHeight = size === "sm" ? "h-6" : "h-7";
  const itemPadding = size === "sm" ? "px-2.5" : "px-3";

  return (
    <div
      role={mode === "tabs" ? "tablist" : undefined}
      aria-label={mode === "tabs" ? ariaLabel : undefined}
      className={cn(
        "inline-flex items-center gap-0.5 border border-foreground/[0.06] bg-foreground/[0.03] p-0.5",
        trackRadius,
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role={mode === "tabs" ? "tab" : undefined}
            aria-selected={mode === "tabs" ? active : undefined}
            aria-pressed={mode === "group" ? active : undefined}
            aria-label={opt.iconOnly ? opt.label : undefined}
            title={opt.iconOnly ? opt.label : undefined}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 text-xs",
              "transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25",
              itemHeight,
              opt.iconOnly ? "px-1.5" : itemPadding,
              itemRadius,
              active
                ? "bg-card font-medium text-foreground shadow-sm ring-1 ring-foreground/[0.06]"
                : "text-muted-foreground/80 hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-3 w-3" strokeWidth={2} />}
            {!opt.iconOnly && <span>{opt.label}</span>}
            {opt.count !== undefined && (
              <span
                className={cn(
                  "tabular-nums",
                  active ? "text-muted-foreground" : "text-muted-foreground/60",
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
