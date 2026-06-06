import { cn } from "@/lib/utils";

interface EmptyHeroProps {
  illustration?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Headless empty-state hero. Provides centered flex layout and minimal
 * defaults (sizing/spacing); each slot accepts arbitrary JSX so callers
 * fully control content and visuals.
 *
 * Plug an AI-generated illustration into `illustration` — typical usage:
 *   <EmptyHero
 *     illustration={<img src={emptyMemoryUrl} className="h-32 w-auto" alt="" />}
 *     title="No memories yet"
 *     description="Save details you want the agent to remember."
 *     action={<Button>Add memory</Button>}
 *   />
 */
export function EmptyHero({ illustration, title, description, action, className }: EmptyHeroProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      {illustration}
      {title && <div className="text-sm font-medium text-foreground">{title}</div>}
      {description && <div className="max-w-xs text-xs text-muted-foreground">{description}</div>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
