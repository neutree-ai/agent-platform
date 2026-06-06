import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DropdownMenuItem } from "./dropdown-menu";
import { cn } from "@/lib/utils";

type DropdownMenuItemProps = React.ComponentPropsWithoutRef<typeof DropdownMenuItem>;

interface ConfirmMenuItemProps extends Omit<DropdownMenuItemProps, "onSelect" | "children"> {
  onConfirm: () => void;
  confirmTimeout?: number;
  icon: React.ReactNode;
  confirmIcon?: React.ReactNode;
  confirmLabel: React.ReactNode;
  children: React.ReactNode;
}

// First click arms (red + alt label, menu stays open); second click within
// confirmTimeout fires onConfirm. Mirrors ConfirmButton but for menu items —
// onSelect is preventDefaulted so the dropdown doesn't close on the arming click.
export function ConfirmMenuItem({
  onConfirm,
  confirmTimeout = 3000,
  icon,
  confirmIcon = <Check />,
  confirmLabel,
  className,
  children,
  ...itemProps
}: ConfirmMenuItemProps) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleSelect = (e: Event) => {
    if (armed) {
      clearTimeout(timerRef.current);
      setArmed(false);
      onConfirm();
      return;
    }
    e.preventDefault();
    setArmed(true);
    timerRef.current = setTimeout(() => setArmed(false), confirmTimeout);
  };

  return (
    <DropdownMenuItem
      {...itemProps}
      onSelect={handleSelect}
      className={cn(className, armed && "text-destructive focus:text-destructive")}
    >
      {armed ? confirmIcon : icon}
      {armed ? confirmLabel : children}
    </DropdownMenuItem>
  );
}
