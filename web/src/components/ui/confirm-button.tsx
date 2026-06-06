import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, type ButtonProps } from "./button";
import { cn } from "@/lib/utils";

interface ConfirmButtonProps extends Omit<ButtonProps, "onClick"> {
  onConfirm: () => void;
  confirmTimeout?: number;
  icon: React.ReactNode;
  confirmIcon?: React.ReactNode;
  confirmLabel?: string;
  tooltip?: string;
}

export function ConfirmButton({
  onConfirm,
  confirmTimeout = 3000,
  icon,
  confirmIcon = <Check className="h-3.5 w-3.5" />,
  confirmLabel,
  tooltip,
  disabled,
  className,
  children,
  ...buttonProps
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  function handleClick() {
    if (armed) {
      onConfirm();
      setArmed(false);
      clearTimeout(timerRef.current);
    } else {
      setArmed(true);
      timerRef.current = setTimeout(() => setArmed(false), confirmTimeout);
    }
  }

  useEffect(() => {
    if (disabled) setArmed(false);
    return () => clearTimeout(timerRef.current);
  }, [disabled]);

  const button = (
    <Button
      {...buttonProps}
      disabled={disabled}
      className={cn(className, armed && "text-destructive hover:text-destructive")}
      onClick={handleClick}
    >
      {armed ? confirmIcon : icon}
      {armed ? (confirmLabel ?? children) : children}
    </Button>
  );

  if (tooltip && !armed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return button;
}
