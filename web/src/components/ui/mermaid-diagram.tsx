import { CopyButton } from "@/components/ui/copy-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFullscreenContainer } from "@/hooks/useFullscreenContainer";
import { downloadFile, svgToPngBlob } from "@/lib/mermaid-export";
import { cn } from "@/lib/utils";
import { Download, Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import type { MermaidConfig } from "mermaid";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.2;
/** Long enough for a streamed fence to settle before we call it a syntax error. */
const RENDER_DEBOUNCE_MS = 200;

function baseConfig(dark: boolean): MermaidConfig {
  return {
    startOnLoad: false,
    theme: dark ? "dark" : "default",
    securityLevel: "strict",
    fontFamily: "monospace",
    suppressErrorRendering: true,
  };
}

async function renderChart(chart: string, id: string, dark: boolean): Promise<string> {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize(baseConfig(dark));
  const { svg } = await mermaid.render(id, chart);
  return svg;
}

/** Tracks the `dark` class the theme switcher toggles on `<html>`. */
function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains("dark")),
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function nodeToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join("");
  if (typeof node === "object" && "props" in node) {
    return nodeToText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

interface ViewportProps {
  svg: string;
  className?: string;
  showControls?: boolean;
}

/**
 * Pan/zoom surface for a rendered diagram. Wheel zoom is modifier-gated so a
 * diagram sitting in a long transcript never eats the page scroll.
 */
function DiagramViewport({ svg, className, showControls = true }: ViewportProps) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragOrigin = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(
    null,
  );

  const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  const reset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragOrigin.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current;
    if (!origin) return;
    setOffset({
      x: origin.offsetX + (event.clientX - origin.x),
      y: origin.offsetY + (event.clientY - origin.y),
    });
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragOrigin.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    setZoom((current) => clampZoom(current - Math.sign(event.deltaY) * ZOOM_STEP));
  };

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {showControls && (
        <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
          <button
            type="button"
            className="rounded-md border border-border bg-background/90 p-1 text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setZoom((current) => clampZoom(current + ZOOM_STEP))}
            title={t("components.mermaid.zoomIn")}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded-md border border-border bg-background/90 p-1 text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setZoom((current) => clampZoom(current - ZOOM_STEP))}
            title={t("components.mermaid.zoomOut")}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded-md border border-border bg-background/90 p-1 text-muted-foreground transition-colors hover:text-foreground"
            onClick={reset}
            title={t("components.mermaid.resetView")}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div
        className="size-full cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        <div
          className="flex justify-center [&_svg]:max-w-full"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "center top",
          }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid output, rendered with securityLevel "strict"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}

/**
 * Renders a ```mermaid fence: diagram plus copy / download / fullscreen.
 *
 * Owning this block instead of using Streamdown's keeps the export path under
 * our control — Streamdown feeds mermaid's raw HTML-flavoured SVG straight to
 * an `<img>`, which fails to load whenever a label contains `<br>` and, when it
 * does load, rasterizes at the browser's 300x150 fallback size. Both the
 * failure and the size were invisible: Streamdown's mermaid block never wires
 * up `onError`, so a failed export did nothing at all. See `lib/mermaid-export.ts`.
 */
export function MermaidDiagram({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const dark = useIsDark();
  const chart = useMemo(() => nodeToText(children).trim(), [children]);
  const renderId = useId().replace(/:/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenContainer = useFullscreenContainer();

  useEffect(() => {
    if (!chart) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      renderChart(chart, `${renderId}-${dark ? "dark" : "light"}`, dark)
        .then((rendered) => {
          if (cancelled) return;
          setSvg(rendered);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
        });
    }, RENDER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [chart, dark, renderId]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  const download = useCallback(
    async (format: "svg" | "png" | "mmd") => {
      try {
        if (format === "mmd") {
          downloadFile("diagram.mmd", chart, "text/plain");
          return;
        }
        if (!svg) throw new Error(t("components.mermaid.notRenderedYet"));
        if (format === "svg") {
          const { normalizeSvg } = await import("@/lib/mermaid-export");
          downloadFile("diagram.svg", normalizeSvg(svg), "image/svg+xml");
          return;
        }
        downloadFile("diagram.png", await svgToPngBlob(svg), "image/png");
      } catch (err) {
        toast.error(t("components.mermaid.exportFailed"), {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [chart, svg, t],
  );

  const toolbar = (
    <div className="flex items-center justify-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="cursor-pointer p-1 text-muted-foreground transition-colors hover:text-foreground"
            title={t("components.mermaid.download")}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void download("png")}>
            {t("components.mermaid.downloadPng")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void download("svg")}>
            {t("components.mermaid.downloadSvg")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void download("mmd")}>
            {t("components.mermaid.downloadMmd")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CopyButton
        value={chart}
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-foreground"
        title={t("components.mermaid.copySource")}
      />
      <button
        type="button"
        className="cursor-pointer p-1 text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setFullscreen(true)}
        title={t("components.mermaid.fullscreen")}
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  if (error && !svg) {
    return (
      <div className="not-prose my-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
        <p className="font-mono text-destructive text-sm">
          {t("components.mermaid.renderFailed")}: {error}
        </p>
        <details className="mt-2">
          <summary className="cursor-pointer text-muted-foreground text-xs">
            {t("components.mermaid.showSource")}
          </summary>
          <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">{chart}</pre>
        </details>
      </div>
    );
  }

  return (
    <div className="not-prose group relative my-4 rounded-xl border border-border p-4">
      {toolbar}
      <DiagramViewport svg={svg} className="min-h-[120px]" />
      {fullscreen &&
        createPortal(
          <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm">
            <div className="flex justify-end p-4">
              <button
                type="button"
                className="rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setFullscreen(false)}
                title={t("components.mermaid.exitFullscreen")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <DiagramViewport svg={svg} className="min-h-0 flex-1 px-4 pb-4" />
          </div>,
          fullscreenContainer ?? document.body,
        )}
    </div>
  );
}
