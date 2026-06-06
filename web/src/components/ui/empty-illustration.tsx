import { cn } from "@/lib/utils";

interface EmptyIllustrationProps {
  /** Asset path relative to /empty/ (e.g. "browser" → /empty/browser.webp) */
  src: string;
  /** Tailwind height class for the image. Default `h-40`. */
  size?: string;
  className?: string;
}

/**
 * Wraps an empty-state illustration with a soft indigo halo so transparent
 * line-drawing assets read with weight on any UI surface. Halo is provided
 * via CSS (token-driven, theme-adaptive); the image itself stays alpha.
 */
export function EmptyIllustration({ src, size = "h-40", className }: EmptyIllustrationProps) {
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <div aria-hidden className="absolute h-48 w-48 rounded-full bg-primary/25 blur-3xl" />
      <img src={`/empty/${src}.webp`} alt="" className={cn("relative w-auto", size)} />
    </div>
  );
}
