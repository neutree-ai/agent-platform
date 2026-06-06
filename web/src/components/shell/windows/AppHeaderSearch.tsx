import { cn } from '@/lib/utils'
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface AppHeaderSearchProps {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  /** Track width — defaults to a tight `w-44` that fits between header
   *  actions without crowding. Pass a wider value when the app's name/
   *  resource list is the primary mode of finding things. */
  width?: 'sm' | 'md'
  className?: string
}

const WIDTHS: Record<'sm' | 'md', string> = {
  sm: 'w-40',
  md: 'w-56',
}

/**
 * Compact search input designed for the AppWindow header. Sits in the
 * portal alongside other header actions; matches the header's text size
 * (text-xs) and h-7 control height so it doesn't fight with
 * AppHeaderButton or SegmentedControl siblings.
 */
export function AppHeaderSearch({
  value,
  onChange,
  placeholder,
  width = 'sm',
  className,
}: AppHeaderSearchProps) {
  const { t } = useTranslation()
  return (
    <div className={cn('relative shrink-0', WIDTHS[width], className)}>
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t('components.resource.search')}
        className={cn(
          'h-7 w-full rounded-md border border-foreground/[0.06] bg-foreground/[0.03] pl-7 pr-7 text-xs',
          'placeholder:text-muted-foreground/60',
          'focus-visible:outline-none focus-visible:border-foreground/[0.12] focus-visible:bg-foreground/[0.05]',
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="clear"
          className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
