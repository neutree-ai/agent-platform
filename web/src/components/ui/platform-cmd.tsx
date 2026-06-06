/**
 * `<platform-cmd>` — a markdown-embedded code block that switches its body
 * by OS. Used in inline docs (`docs/inline-help/*.md`) so a single doc can
 * carry per-platform commands without forking the markdown per locale.
 *
 * Usage in markdown — YAML body with one block per OS:
 *
 *     <platform-cmd>
 *     macos: |
 *       COPYFILE_DISABLE=1 tar --exclude='.DS_Store' --exclude='._*' \
 *         -czf skill.tar.gz -C /path/to/skill-dir .
 *     linux: |
 *       tar -czf skill.tar.gz -C /path/to/skill-dir .
 *     windows: |
 *       tar -czf skill.tar.gz -C C:\path\to\skill-dir .
 *     </platform-cmd>
 *
 * YAML beats JSON here because Windows paths and shell snippets read
 * cleanly without escaping; block scalars (`|`) carry multi-line commands
 * as-is. Selected platform persists to localStorage so the choice
 * carries across docs and dialog re-opens.
 */
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { Children, type ReactNode, useEffect, useState } from "react";
import { parse as parseYaml } from "yaml";

type Platform = "macos" | "linux" | "windows";
const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "macos", label: "macOS" },
  { value: "linux", label: "Linux" },
  { value: "windows", label: "Windows" },
];

const STORAGE_KEY = "tos.docs.platformPref";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "macos";
  // Prefer UA-CH (Chromium), fall back to legacy platform + UA sniffing.
  const uaPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  const hint = `${uaPlatform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  if (/Win/i.test(hint)) return "windows";
  if (/Mac|Darwin/i.test(hint)) return "macos";
  if (/Linux|X11|CrOS/i.test(hint)) return "linux";
  return "macos";
}

function loadPref(): Platform {
  if (typeof window === "undefined") return "macos";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "macos" || stored === "linux" || stored === "windows") return stored;
  return detectPlatform();
}

function flattenChildrenToText(children: ReactNode): string {
  // Streamdown wraps the body in `<p>` etc; flatten to a JSON string.
  let out = "";
  Children.forEach(children, (c) => {
    if (typeof c === "string") out += c;
    else if (typeof c === "number") out += String(c);
    else if (c && typeof c === "object" && "props" in c) {
      out += flattenChildrenToText((c as { props: { children?: ReactNode } }).props.children);
    }
  });
  return out;
}

export function PlatformCmd({ children }: { children?: ReactNode }) {
  const [platform, setPlatform] = useState<Platform>(() => loadPref());
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, platform);
    }
  }, [platform]);

  // Parse the YAML body. Defensive: bad markup falls back to the raw text
  // so a doc author sees the original block rather than a crash.
  const raw = flattenChildrenToText(children).trim();
  let commands: Partial<Record<Platform, string>>;
  try {
    const parsed: unknown = parseYaml(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    // Coerce values to strings — YAML may hand back numbers/booleans for an
    // accidental unquoted scalar.
    const out: Partial<Record<Platform, string>> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if ((k === "macos" || k === "linux" || k === "windows") && v != null) {
        out[k] = String(v).replace(/\n+$/, "");
      }
    }
    commands = out;
  } catch {
    return (
      <pre className="my-2 rounded-md bg-foreground/[0.06] p-2 font-mono text-tiny">
        {raw || "<platform-cmd>: invalid YAML body"}
      </pre>
    );
  }
  const cmd = commands[platform] ?? Object.values(commands)[0] ?? "";

  return (
    <div className="not-prose my-2 space-y-1.5">
      <SegmentedControl
        value={platform}
        onValueChange={(v) => setPlatform(v as Platform)}
        variant="pill"
        size="sm"
        options={PLATFORMS}
      />
      <code
        className={cn(
          "block whitespace-pre-wrap break-all rounded-md",
          "bg-foreground/[0.06] px-2 py-1.5 font-mono text-[11px]",
        )}
      >
        {cmd}
      </code>
    </div>
  );
}
