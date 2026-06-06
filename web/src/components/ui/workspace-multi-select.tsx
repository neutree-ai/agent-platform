import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import type { Workspace } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface WorkspaceMultiSelectProps {
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  className?: string;
}

export function WorkspaceMultiSelect({
  value,
  onChange,
  disabled,
  className,
}: WorkspaceMultiSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data } = useWorkspaces();
  const workspaces: Workspace[] = data ?? [];

  const selected = workspaces.filter((w) => value.includes(w.id));

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  function remove(id: string) {
    onChange(value.filter((v) => v !== id));
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex min-h-7 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm ring-offset-background",
            "focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          {selected.length === 0 ? (
            <span className="text-muted-foreground">
              {t("components.workspaceMultiSelect.placeholder")}
            </span>
          ) : (
            selected.map((ws) => (
              <span
                key={ws.id}
                className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 font-medium text-secondary-foreground"
              >
                <span className="max-w-32 truncate">{ws.name}</span>
                <span
                  // biome-ignore lint/a11y/useSemanticElements: nested in trigger button; <button> would be invalid HTML
                  role="button"
                  tabIndex={-1}
                  aria-label={t("components.workspaceMultiSelect.remove", { name: ws.name })}
                  className="shrink-0 opacity-60 hover:opacity-100"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    remove(ws.id);
                  }}
                >
                  <X className="h-2.5 w-2.5" />
                </span>
              </span>
            ))
          )}
          <ChevronsUpDown className="ml-auto h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] overflow-hidden p-0"
        align="start"
      >
        <Command>
          <CommandInput
            placeholder={t("components.workspaceMultiSelect.search")}
            className="h-8 text-xs"
          />
          <CommandList className="max-h-60 overflow-y-auto">
            <CommandEmpty className="py-3 text-xs">
              {t("components.workspaceMultiSelect.empty")}
            </CommandEmpty>
            <CommandGroup>
              {workspaces.map((ws) => {
                const checked = value.includes(ws.id);
                return (
                  <CommandItem
                    key={ws.id}
                    value={ws.name}
                    onSelect={() => toggle(ws.id)}
                    className="text-xs"
                  >
                    <Check
                      className={cn("mr-2 h-3 w-3 shrink-0", checked ? "opacity-100" : "opacity-0")}
                    />
                    <span className="truncate">{ws.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
