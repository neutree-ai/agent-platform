import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface CopyButtonProps extends Omit<ButtonProps, "onClick" | "children" | "value"> {
  /** Text to copy. Either pass a string or a function that returns one. */
  value: string | (() => string | Promise<string>);
  /** Optional label shown to the right of the icon. Icon-only when omitted. */
  label?: string;
  /** How long to show the success state. Defaults to 1800ms. */
  successMs?: number;
  /**
   * Toast on copy failure. Defaults to true. Disable when the parent surfaces
   * its own error UI (e.g. inline error in a form).
   */
  toastOnError?: boolean;
  onCopied?: () => void;
}

/**
 * Drop-in copy button. Click to copy, swaps icon to a green check for ~1.8s
 * for visual confirmation. Use this anywhere a user copies a token, link, or
 * snippet — keeps the affordance consistent across the app.
 */
export const CopyButton = forwardRef<HTMLButtonElement, CopyButtonProps>(function CopyButton(
  {
    value,
    label,
    successMs = 1800,
    toastOnError = true,
    onCopied,
    className,
    variant = "ghost",
    size,
    ...props
  },
  ref,
) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function handleClick() {
    try {
      const text = typeof value === "function" ? await value() : value;
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopied?.();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), successMs);
    } catch (err) {
      if (toastOnError) {
        toast.error(
          err instanceof Error ? err.message : t("components.copyButton.errors.copyFailed"),
        );
      }
    }
  }

  const Icon = copied ? Check : Copy;
  const labelText =
    label ?? t(copied ? "components.copyButton.copied" : "components.copyButton.copy");
  const iconOnly = label === undefined && (size === "icon" || size === undefined);

  return (
    <Button
      ref={ref}
      type="button"
      variant={variant}
      size={size ?? (label ? "sm" : "icon")}
      onClick={handleClick}
      title={iconOnly ? labelText : undefined}
      aria-label={iconOnly ? labelText : undefined}
      className={cn(
        copied && "text-success hover:text-success",
        size === "icon" || (!label && !size) ? "h-6 w-6" : undefined,
        className,
      )}
      {...props}
    >
      <Icon className={cn(label ? "mr-1 h-3 w-3" : "h-3 w-3")} />
      {label && <span>{labelText}</span>}
    </Button>
  );
});
