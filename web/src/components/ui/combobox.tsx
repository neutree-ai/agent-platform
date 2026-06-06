import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  /** When true the option is rendered but not selectable. */
  disabled?: boolean;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  /** Allow clearing the selection (shows a "None" option) */
  allowNone?: boolean;
  noneLabel?: string;
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  className,
  allowNone,
  noneLabel,
}: ComboboxProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const resolvedPlaceholder = placeholder ?? t("components.combobox.placeholders.select");
  const resolvedSearchPlaceholder =
    searchPlaceholder ?? t("components.combobox.placeholders.search");
  const resolvedEmptyText = emptyText ?? t("components.combobox.empty.noResults");
  const resolvedNoneLabel = noneLabel ?? t("components.combobox.options.none");

  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          // biome-ignore lint/a11y/useSemanticElements: shadcn combobox pattern, not a native <select>
          role="combobox"
          aria-expanded={open}
          className={cn("h-7 w-full justify-between text-xs font-normal", className)}
        >
          <span className="truncate">{selected?.label ?? resolvedPlaceholder}</span>
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] overflow-hidden p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={resolvedSearchPlaceholder} className="h-8 text-xs" />
          <CommandList className="max-h-60 overflow-y-auto">
            <CommandEmpty className="py-3 text-xs">{resolvedEmptyText}</CommandEmpty>
            <CommandGroup>
              {allowNone && (
                <CommandItem
                  value={resolvedNoneLabel}
                  onSelect={() => {
                    onValueChange("");
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  <Check
                    className={cn("mr-2 h-3 w-3 shrink-0", !value ? "opacity-100" : "opacity-0")}
                  />
                  <span className="text-muted-foreground">{resolvedNoneLabel}</span>
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  disabled={o.disabled}
                  onSelect={() => {
                    if (o.disabled) return;
                    onValueChange(o.value);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  <Check
                    className={cn(
                      "mr-2 h-3 w-3 shrink-0",
                      value === o.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="flex flex-col min-w-0">
                    <span>{o.label}</span>
                    {o.description && (
                      <span className="text-tiny text-muted-foreground whitespace-normal">
                        {o.description}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
