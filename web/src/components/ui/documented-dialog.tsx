import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ui/markdown";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DocumentedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  docs?: string;
  docsHint?: string;
  /** Dialog size: 'md' (default), 'lg', 'xl'. Controls max-width when docs are shown. */
  size?: "md" | "lg" | "xl";
  footer?: React.ReactNode;
  children: React.ReactNode;
}

const SIZE_CLASSES = {
  md: { withDocs: "sm:max-w-4xl", withoutDocs: "sm:max-w-md", height: "h-[60vh]" },
  lg: { withDocs: "sm:max-w-6xl", withoutDocs: "sm:max-w-lg", height: "h-[70vh]" },
  xl: { withDocs: "sm:max-w-7xl", withoutDocs: "sm:max-w-xl", height: "h-[75vh]" },
};

export function DocumentedDialog({
  open,
  onOpenChange,
  title,
  docs,
  docsHint,
  size = "md",
  footer,
  children,
}: DocumentedDialogProps) {
  const hasDocs = !!docs;
  const s = SIZE_CLASSES[size];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("p-0 gap-0 overflow-hidden", hasDocs ? s.withDocs : s.withoutDocs)}
      >
        {/* `min-h-0` on the outer flex + every flex child is required so
            Safari clamps to the configured height instead of letting the
            docs markdown's intrinsic height push the dialog taller and
            jitter as ConfigFormFields' scroll-driven visibleSections
            re-renders.  Each panel also gets explicit `flex-basis` rather
            than `w-3/5` / `w-2/5`: under content pressure Safari treats
            fractional widths as suggestions and can collapse the docs
            panel to ~0 when the form column has long content. */}
        <div className={cn("flex min-h-0", hasDocs && s.height)}>
          {/* Left: form */}
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-col",
              hasDocs ? "basis-3/5 shrink-0 border-r border-border" : "w-full",
            )}
          >
            <DialogHeader className="shrink-0 px-6 pt-5 pb-3">
              <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">{children}</div>
            {footer && <DialogFooter className="shrink-0 px-6 pb-5 pt-0">{footer}</DialogFooter>}
          </div>

          {/* Right: docs */}
          {hasDocs && (
            <div className="flex min-h-0 min-w-0 basis-2/5 flex-col overflow-y-auto">
              <div className="px-6 py-6">
                {docsHint && <div className="mb-4 text-tiny text-muted-foreground">{docsHint}</div>}
                <Markdown
                  key={docs}
                  className="text-xs [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-xs [&_p]:text-xs [&_li]:text-xs [&_code]:text-tiny"
                >
                  {docs}
                </Markdown>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
