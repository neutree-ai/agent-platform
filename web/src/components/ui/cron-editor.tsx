import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { describeCron } from "@/lib/cron-describe";
import { CronExpressionParser } from "cron-parser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type Period = "minute" | "hour" | "day" | "week" | "month" | "interval" | "custom";

type IntervalUnit = "minute" | "hour" | "day";

interface ParsedCron {
  period: Period;
  minute: number;
  hour: number;
  dayOfMonth: number;
  weekdays: string[];
  intervalUnit: IntervalUnit;
  intervalValue: number;
}

const DEFAULTS: ParsedCron = {
  period: "custom",
  minute: 0,
  hour: 9,
  dayOfMonth: 1,
  weekdays: ["1"],
  intervalUnit: "hour",
  intervalValue: 2,
};

const WEEKDAY_VALUES = ["1", "2", "3", "4", "5", "6", "0"] as const;

// ─── Presets ────────────────────────────────────────────────────

interface CronPreset {
  key: string;
  cron: string;
}

const PRESETS: CronPreset[] = [
  { key: "dailyMorning", cron: "0 9 * * *" },
  { key: "weekdaysMorning", cron: "0 9 * * 1-5" },
  { key: "hourly", cron: "0 * * * *" },
  { key: "monthlyFirst", cron: "0 9 1 * *" },
  { key: "weeklyMonday", cron: "0 9 * * 1" },
];

// ─── Parse / build ──────────────────────────────────────────────

function parseCron(cron: string): ParsedCron {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { ...DEFAULTS };

  const [min, hr, dom, mon, dow] = parts;

  // Every minute: * * * * *
  if (min === "*" && hr === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { ...DEFAULTS, period: "minute" };
  }

  // Interval: */N * * * *
  const minIntervalMatch = min.match(/^\*\/(\d+)$/);
  if (minIntervalMatch && hr === "*" && dom === "*" && mon === "*" && dow === "*") {
    return {
      ...DEFAULTS,
      period: "interval",
      intervalUnit: "minute",
      intervalValue: Number(minIntervalMatch[1]),
    };
  }

  const minute = Number(min);
  if (Number.isNaN(minute) || minute < 0 || minute > 59) return { ...DEFAULTS };

  // Every hour at :M — N * * * *
  if (hr === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { ...DEFAULTS, period: "hour", minute };
  }

  // Interval hours: 0 */N * * *
  const hrIntervalMatch = hr.match(/^\*\/(\d+)$/);
  if (hrIntervalMatch && min === "0" && dom === "*" && mon === "*" && dow === "*") {
    return {
      ...DEFAULTS,
      period: "interval",
      intervalUnit: "hour",
      intervalValue: Number(hrIntervalMatch[1]),
    };
  }

  const hour = Number(hr);
  if (Number.isNaN(hour) || hour < 0 || hour > 23) return { ...DEFAULTS };

  // Every day: M H * * *
  if (dom === "*" && mon === "*" && dow === "*") {
    return { ...DEFAULTS, period: "day", minute, hour };
  }

  // Interval days: 0 0 */N * *
  const domIntervalMatch = dom.match(/^\*\/(\d+)$/);
  if (domIntervalMatch && min === "0" && hr === "0" && mon === "*" && dow === "*") {
    return {
      ...DEFAULTS,
      period: "interval",
      intervalUnit: "day",
      intervalValue: Number(domIntervalMatch[1]),
    };
  }

  // Every week: M H * * D[,D...] or D-D
  if (dom === "*" && mon === "*" && dow !== "*") {
    const weekdays = expandDow(dow);
    if (weekdays.length > 0) {
      return { ...DEFAULTS, period: "week", minute, hour, weekdays };
    }
    return { ...DEFAULTS };
  }

  // Every month: M H D * *
  if (mon === "*" && dow === "*") {
    const day = Number(dom);
    if (!Number.isNaN(day) && day >= 1 && day <= 31) {
      return { ...DEFAULTS, period: "month", minute, hour, dayOfMonth: day };
    }
  }

  return { ...DEFAULTS };
}

function expandDow(dow: string): string[] {
  // Accept "1-5" range or "1,3,5" list
  if (/^\d-\d$/.test(dow)) {
    const [a, b] = dow.split("-").map(Number);
    if (a >= 0 && b >= a && b <= 6) {
      return Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
    }
  }
  return dow.split(",").filter((d) => /^[0-6]$/.test(d));
}

function buildCron(parsed: ParsedCron): string {
  switch (parsed.period) {
    case "minute":
      return "* * * * *";
    case "hour":
      return `${parsed.minute} * * * *`;
    case "day":
      return `${parsed.minute} ${parsed.hour} * * *`;
    case "week":
      return `${parsed.minute} ${parsed.hour} * * ${parsed.weekdays.join(",")}`;
    case "month":
      return `${parsed.minute} ${parsed.hour} ${parsed.dayOfMonth} * *`;
    case "interval": {
      const n = Math.max(1, parsed.intervalValue);
      if (parsed.intervalUnit === "minute") return `*/${n} * * * *`;
      if (parsed.intervalUnit === "hour") return `0 */${n} * * *`;
      return `0 0 */${n} * *`;
    }
    default:
      return "* * * * *";
  }
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// ─── Sub-controls ───────────────────────────────────────────────

function MinuteSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-20 h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Array.from({ length: 60 }, (_, i) => (
          <SelectItem key={i} value={String(i)} className="text-xs">
            :{pad(i)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function HourMinuteSelect({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
}: {
  hour: number;
  minute: number;
  onHourChange: (v: number) => void;
  onMinuteChange: (v: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      <Select value={String(hour)} onValueChange={(v) => onHourChange(Number(v))}>
        <SelectTrigger className="w-20 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 24 }, (_, i) => (
            <SelectItem key={i} value={String(i)} className="text-xs">
              {pad(i)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">
        {t("components.cronEditor.labels.timeSeparator")}
      </span>
      <MinuteSelect value={minute} onChange={onMinuteChange} />
    </div>
  );
}

// Number input that holds an intermediate text state so the user can
// backspace down to "" without the value snapping back to 1 on each
// keystroke. Commits to the parent only when the text parses to a valid
// in-range integer; reverts to the last good value on blur if invalid.
function IntervalNumberInput({
  parsedValue,
  max,
  onCommit,
}: { parsedValue: number; max: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(parsedValue));

  // When the parsed value changes from outside (preset click, period
  // switch, etc.), refresh the local text. Compare-then-set so onCommit
  // round-trips don't fight with the user's typing.
  const lastParsedRef = useRef(parsedValue);
  useEffect(() => {
    if (lastParsedRef.current !== parsedValue) {
      lastParsedRef.current = parsedValue;
      setText(String(parsedValue));
    }
  }, [parsedValue]);

  return (
    <Input
      type="number"
      min={1}
      max={max}
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const n = Number(next);
        if (next !== "" && Number.isInteger(n) && n >= 1 && n <= max) {
          onCommit(n);
        }
      }}
      onBlur={() => {
        const n = Number(text);
        if (Number.isNaN(n) || !Number.isInteger(n) || n < 1) {
          setText(String(parsedValue));
        } else if (n > max) {
          setText(String(max));
          onCommit(max);
        }
      }}
      className="h-8 w-16 text-xs"
    />
  );
}

function WeekdayToggle({
  selected,
  onChange,
}: { selected: string[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation();
  const toggle = (day: string) => {
    const next = selected.includes(day) ? selected.filter((d) => d !== day) : [...selected, day];
    if (next.length > 0) onChange(next);
  };

  return (
    <div className="flex gap-1">
      {WEEKDAY_VALUES.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => toggle(d)}
          className={`h-7 w-9 rounded text-tiny font-medium transition-colors ${
            selected.includes(d)
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {t(`components.cronEditor.weekdays.${d}`)}
        </button>
      ))}
    </div>
  );
}

// ─── cron-parser helper ──────────────────────────────────────────

interface NextFire {
  date: Date;
}

function computeNextFires(cron: string, tz: string | undefined, count = 3): NextFire[] | null {
  try {
    const exp = CronExpressionParser.parse(cron, tz ? { tz } : undefined);
    const out: NextFire[] = [];
    for (let i = 0; i < count; i++) {
      out.push({ date: exp.next().toDate() });
    }
    return out;
  } catch {
    return null;
  }
}

function formatFire(date: Date, tz: string | undefined, language: string): string {
  // Use Intl with the schedule's timezone so the preview reflects when the
  // cron actually fires for the user, not the browser's local time.
  const locale = language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  const opts: Intl.DateTimeFormatOptions = {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: tz }).format(date);
  } catch {
    // Some OSes report a timezone (e.g. "Etc/Unknown") that DateTimeFormat
    // rejects. Fall back to the browser's local time rather than crashing.
    return new Intl.DateTimeFormat(locale, opts).format(date);
  }
}

// ─── Main ────────────────────────────────────────────────────────

export function CronEditor({
  value,
  onChange,
  timezone,
}: { value: string; onChange: (cron: string) => void; timezone?: string }) {
  const { t, i18n } = useTranslation();
  const [forceCustom, setForceCustom] = useState(false);
  const parsed = useMemo(() => parseCron(value), [value]);

  const update = useCallback(
    (patch: Partial<ParsedCron>) => {
      const next = { ...parsed, ...patch };
      onChange(buildCron(next));
    },
    [parsed, onChange],
  );

  const handlePeriodChange = useCallback(
    (period: Period) => {
      if (period === "custom") {
        setForceCustom(true);
        return;
      }
      setForceCustom(false);
      const next: ParsedCron = { ...parsed, period };
      if (period === "week" && parsed.weekdays.length === 0) {
        next.weekdays = ["1"];
      }
      onChange(buildCron(next));
    },
    [parsed, onChange],
  );

  const displayPeriod: Period = forceCustom
    ? "custom"
    : parsed.period === "custom"
      ? "custom"
      : parsed.period;

  const description = useMemo(() => describeCron(value, i18n.language), [value, i18n.language]);
  const nextFires = useMemo(() => computeNextFires(value, timezone, 3), [value, timezone]);

  return (
    <div className="space-y-3">
      {/* Quick presets */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const active = value === p.cron;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                setForceCustom(false);
                onChange(p.cron);
              }}
              className={`h-6 rounded-full border px-2 text-tiny font-medium transition-colors ${
                active
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-foreground/[0.08] bg-foreground/[0.03] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
              }`}
            >
              {t(`components.cronEditor.presets.${p.key}`)}
            </button>
          );
        })}
      </div>

      {/* Period config — single inline row per period.
          The period select itself reads as "Every day" / "Every month" /
          ..., so there's no need for an extra "Repeat" label. Day/time
          pickers sit on the same line with the period dropdown. */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={displayPeriod} onValueChange={(v) => handlePeriodChange(v as Period)}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="minute" className="text-xs">
              {t("components.cronEditor.periods.minute")}
            </SelectItem>
            <SelectItem value="hour" className="text-xs">
              {t("components.cronEditor.periods.hour")}
            </SelectItem>
            <SelectItem value="day" className="text-xs">
              {t("components.cronEditor.periods.day")}
            </SelectItem>
            <SelectItem value="week" className="text-xs">
              {t("components.cronEditor.periods.week")}
            </SelectItem>
            <SelectItem value="month" className="text-xs">
              {t("components.cronEditor.periods.month")}
            </SelectItem>
            <SelectItem value="interval" className="text-xs">
              {t("components.cronEditor.periods.interval")}
            </SelectItem>
            <SelectItem value="custom" className="text-xs">
              {t("components.cronEditor.periods.custom")}
            </SelectItem>
          </SelectContent>
        </Select>

        {displayPeriod === "hour" && (
          <>
            <span className="text-xs text-muted-foreground">
              {t("components.cronEditor.labels.atMinute")}
            </span>
            <MinuteSelect value={parsed.minute} onChange={(minute) => update({ minute })} />
          </>
        )}

        {displayPeriod === "day" && (
          <HourMinuteSelect
            hour={parsed.hour}
            minute={parsed.minute}
            onHourChange={(hour) => update({ hour })}
            onMinuteChange={(minute) => update({ minute })}
          />
        )}

        {displayPeriod === "month" && (
          <>
            <Select
              value={String(parsed.dayOfMonth)}
              onValueChange={(v) => update({ dayOfMonth: Number(v) })}
            >
              <SelectTrigger className="h-8 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 31 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)} className="text-xs">
                    {t("components.cronEditor.labels.dayN", { n: i + 1 })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <HourMinuteSelect
              hour={parsed.hour}
              minute={parsed.minute}
              onHourChange={(hour) => update({ hour })}
              onMinuteChange={(minute) => update({ minute })}
            />
          </>
        )}

        {displayPeriod === "interval" && (
          <>
            <IntervalNumberInput
              parsedValue={parsed.intervalValue}
              max={parsed.intervalUnit === "minute" ? 59 : parsed.intervalUnit === "hour" ? 23 : 30}
              onCommit={(n) => update({ intervalValue: n })}
            />
            <Select
              value={parsed.intervalUnit}
              onValueChange={(v) => update({ intervalUnit: v as IntervalUnit })}
            >
              <SelectTrigger className="h-8 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minute" className="text-xs">
                  {t("components.cronEditor.intervalUnits.minute")}
                </SelectItem>
                <SelectItem value="hour" className="text-xs">
                  {t("components.cronEditor.intervalUnits.hour")}
                </SelectItem>
                <SelectItem value="day" className="text-xs">
                  {t("components.cronEditor.intervalUnits.day")}
                </SelectItem>
              </SelectContent>
            </Select>
          </>
        )}

        {displayPeriod === "custom" && (
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t("components.cronEditor.placeholders.expression")}
            className="h-8 flex-1 min-w-[10rem] font-mono text-xs"
          />
        )}
      </div>

      {/* Week needs its own row — weekday toggle is wide enough that
          stacking it under the period+time row reads better than wrapping. */}
      {displayPeriod === "week" && (
        <div className="space-y-2">
          <WeekdayToggle selected={parsed.weekdays} onChange={(weekdays) => update({ weekdays })} />
          <HourMinuteSelect
            hour={parsed.hour}
            minute={parsed.minute}
            onHourChange={(hour) => update({ hour })}
            onMinuteChange={(minute) => update({ minute })}
          />
        </div>
      )}

      {/* Preview — natural-language description + next fires. Raw cron is
          intentionally absent from the preview: it only appears in the
          custom-mode input box where the user is typing it directly. */}
      {(description || nextFires) && (
        <div className="space-y-1 rounded-md border border-foreground/[0.08] bg-foreground/[0.02] px-2.5 py-2">
          {description ? (
            <div className="text-xs text-foreground">{description}</div>
          ) : (
            <div className="text-xs text-destructive">
              {t("components.cronEditor.hints.invalid")}
            </div>
          )}
          {nextFires && nextFires.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-mini text-muted-foreground">
              <span className="shrink-0">{t("components.cronEditor.labels.next")}</span>
              {nextFires.map((f, i) => (
                <span key={f.date.toISOString()} className="tabular-nums">
                  {formatFire(f.date, timezone, i18n.language)}
                  {i < nextFires.length - 1 && (
                    <span aria-hidden className="ml-2 text-muted-foreground/40">
                      ·
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
