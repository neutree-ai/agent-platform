import { Markdown } from '@/components/ui/markdown'
import { cn } from '@/lib/utils'

interface PromptViewerProps {
  content: string
  /**
   * `inline`: compact read-only rendering for the PromptField preview, Picker hover popover, and TemplateConfigView
   * `panel`: full-page detail area (right column of the Library main page)
   */
  variant?: 'inline' | 'panel'
  emptyText?: string
  /** Inline variant max height (CSS value). Default 300px */
  maxHeight?: string
  className?: string
}

export function PromptViewer({
  content,
  variant = 'inline',
  emptyText,
  maxHeight = '300px',
  className,
}: PromptViewerProps) {
  const isEmpty = !content.trim()

  if (variant === 'panel') {
    return (
      <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', className)}>
        <div className="max-w-3xl">
          {isEmpty ? (
            <p className="text-sm text-muted-foreground/60">{emptyText}</p>
          ) : (
            <Markdown className="text-sm">{content}</Markdown>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'overflow-y-auto rounded border border-border bg-muted/30 px-3 py-2',
        className,
      )}
      style={{ maxHeight }}
    >
      {isEmpty ? (
        <p className="text-xs text-muted-foreground/60">{emptyText}</p>
      ) : (
        <Markdown className="text-xs leading-relaxed">{content}</Markdown>
      )}
    </div>
  )
}
