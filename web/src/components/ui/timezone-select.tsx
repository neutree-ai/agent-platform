import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const POPULAR_TIMEZONES = [
  "UTC",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Australia/Sydney",
];

function getOffset(tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" });
    const parts = fmt.formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

// Some OSes / misconfigured environments report a timezone that
// `resolvedOptions()` returns happily but that throws when fed back into a
// `DateTimeFormat` (e.g. "Etc/Unknown"). Round-trip it through the constructor
// so callers never receive a value that will later crash formatting.
export function isValidTimezone(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function getBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimezone(tz) ? tz : "UTC";
  } catch {
    return "UTC";
  }
}

let _allTimezones: string[] | null = null;
function getAllTimezones(): string[] {
  if (!_allTimezones) {
    try {
      _allTimezones = (
        Intl as unknown as { supportedValuesOf(key: string): string[] }
      ).supportedValuesOf("timeZone");
    } catch {
      _allTimezones = POPULAR_TIMEZONES;
    }
  }
  return _allTimezones;
}

export function TimezoneSelect({
  value,
  onChange,
}: { value: string; onChange: (tz: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const otherTimezones = useMemo(() => {
    const all = getAllTimezones();
    const popularSet = new Set(POPULAR_TIMEZONES);
    return all.filter((tz: string) => !popularSet.has(tz));
  }, []);

  // Only render "other" timezones when the user is actually searching
  const hasSearch = search.trim().length > 0;

  const displayLabel = value
    ? `${value} (${getOffset(value)})`
    : t("components.timezoneSelect.placeholders.select");

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          // biome-ignore lint/a11y/useSemanticElements: shadcn combobox pattern, not a native <select>
          role="combobox"
          aria-expanded={open}
          className="h-8 w-full justify-between text-xs font-normal"
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] overflow-hidden p-0"
        align="start"
      >
        <Command className="overflow-hidden">
          <CommandInput
            placeholder={t("components.timezoneSelect.placeholders.search")}
            className="h-8 text-xs"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-48 overflow-y-auto">
            <CommandEmpty className="py-3 text-xs">
              {t("components.timezoneSelect.empty.notFound")}
            </CommandEmpty>
            <CommandGroup heading={t("components.timezoneSelect.groups.common")}>
              {POPULAR_TIMEZONES.map((tz) => (
                <CommandItem
                  key={tz}
                  value={tz}
                  onSelect={() => {
                    onChange(tz);
                    setOpen(false);
                    setSearch("");
                  }}
                  className="text-xs"
                >
                  <Check
                    className={cn("mr-2 h-3 w-3", value === tz ? "opacity-100" : "opacity-0")}
                  />
                  {tz}
                  <span className="ml-auto text-mini text-muted-foreground">{getOffset(tz)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {hasSearch && (
              <>
                <CommandSeparator />
                <CommandGroup heading={t("components.timezoneSelect.groups.all")}>
                  {otherTimezones.map((tz: string) => (
                    <CommandItem
                      key={tz}
                      value={tz}
                      onSelect={() => {
                        onChange(tz);
                        setOpen(false);
                        setSearch("");
                      }}
                      className="text-xs"
                    >
                      <Check
                        className={cn("mr-2 h-3 w-3", value === tz ? "opacity-100" : "opacity-0")}
                      />
                      {tz}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
