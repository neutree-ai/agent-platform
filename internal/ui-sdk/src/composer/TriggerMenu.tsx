import { type ReactNode, useEffect, useRef } from 'react'
import { cn } from '../lib/utils'
import type { ComposerTriggerItem } from './types'

export type TriggerMenuRow = Pick<
  ComposerTriggerItem,
  'key' | 'icon' | 'label' | 'description' | 'meta'
>

/** Element id of option `index` inside the listbox `listboxId`. */
export function triggerOptionId(listboxId: string, index: number): string {
  return `${listboxId}-opt-${index}`
}

/**
 * Suggestion listbox anchored above the composer input. Focus stays in the
 * textarea (which points at the active option via `aria-activedescendant`);
 * keyboard handling lives with the textarea so menu keys can win over submit.
 * Options select on mousedown with `preventDefault` so the textarea keeps
 * focus and its caret.
 */
export function TriggerMenu({
  id,
  label,
  rows,
  activeIndex,
  header,
  onActiveIndexChange,
  onPick,
}: {
  id: string
  label: string
  rows: TriggerMenuRow[]
  activeIndex: number
  header?: ReactNode
  onActiveIndexChange: (index: number) => void
  onPick: (index: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the active row visible during keyboard navigation. `nearest` is a
  // no-op for rows already on screen, so hover-driven changes don't jitter.
  useEffect(() => {
    const row = listRef.current?.children[activeIndex] as HTMLElement | undefined
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  return (
    <div className="absolute bottom-full left-0 right-0 z-50 mb-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
      {header && (
        <div className="border-b border-border px-2 py-1 text-mini text-muted-foreground">
          {header}
        </div>
      )}
      {/* biome-ignore lint/a11y/useFocusableInteractive: focus stays in the textarea, which drives this listbox via aria-activedescendant */}
      <div
        ref={listRef}
        id={id}
        // biome-ignore lint/a11y/useSemanticElements: a native <select> can't be driven from the textarea
        role="listbox"
        aria-label={label}
        className="max-h-48 overflow-y-auto p-1"
      >
        {rows.map((row, i) => (
          <div
            key={row.key}
            id={triggerOptionId(id, i)}
            // biome-ignore lint/a11y/useSemanticElements: options of the ARIA listbox above
            role="option"
            aria-selected={i === activeIndex}
            tabIndex={-1}
            className={cn(
              'flex w-full cursor-default gap-2 rounded-sm px-2 py-1.5 text-left',
              row.description ? 'items-start' : 'items-center',
              i === activeIndex ? 'bg-accent' : 'hover:bg-accent',
            )}
            onMouseEnter={() => onActiveIndexChange(i)}
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(i)
            }}
          >
            {row.icon}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs">{row.label}</div>
              {row.description && (
                <div className="truncate text-tiny text-muted-foreground">{row.description}</div>
              )}
            </div>
            {row.meta && (
              <span
                className={cn(
                  'shrink-0 text-mini text-muted-foreground',
                  row.description && 'mt-0.5',
                )}
              >
                {row.meta}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
