import { ResourceFilterTabs, type ScopeFilter } from '@/components/resource/ResourceFilterTabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { type LucideIcon, Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

const WIDTH: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'w-48',
  md: 'w-56',
  lg: 'w-64',
}

interface MasterSidebarProps {
  width?: keyof typeof WIDTH
  className?: string
  children: ReactNode
}

/**
 * Left rail for app-internal master-detail layouts (connector list,
 * future per-resource navigators). Distinct from the global Dock —
 * uses a quieter selected state and tighter rows so a screen with
 * Dock + MasterSidebar doesn't read as two competing nav columns.
 *
 * Compose with `<MasterSidebar.Search>`, `<MasterSidebar.ScopeFilter>`,
 * `<MasterSidebar.List>` and `<MasterSidebar.Item>`.
 */
export function MasterSidebar({ width = 'md', className, children }: MasterSidebarProps) {
  return (
    <div className={cn('flex shrink-0 p-2', WIDTH[width], className)}>
      <div
        className={cn(
          'relative flex h-full w-full flex-col overflow-hidden',
          // Floating glass panel — same treatment language as the Dock
          // (gradient wash + backdrop blur + inset ring + soft shadow)
          // so the rail reads as a lifted material surface rather than
          // a flush partition.
          'rounded-2xl border border-foreground/[0.08]',
          // Prismatic vertical wash mirrors the Dock's horizontal one —
          // primary at top fading through neutral into info at bottom.
          // The chroma is what gives backdrop-blur something to refract;
          // a flat foreground/alpha wash leaves the glass invisible.
          'bg-gradient-to-b from-primary/[0.06] via-foreground/[0.02] to-info/[0.06]',
          'backdrop-blur-2xl backdrop-saturate-150',
          'shadow-xl ring-1 ring-inset ring-foreground/[0.04]',
        )}
      >
        {children}
      </div>
    </div>
  )
}

interface SearchProps {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  /** Optional trailing action (e.g., a "+" icon button) rendered next to the input. */
  action?: ReactNode
}

function MasterSidebarSearch({ value, onChange, placeholder, action }: SearchProps) {
  const { t } = useTranslation()
  return (
    <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
      <div className="relative flex-1">
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
            aria-label={t('common.clear')}
            className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {action}
    </div>
  )
}

interface ScopeFilterProps {
  value: ScopeFilter
  onValueChange: (next: ScopeFilter) => void
  counts?: Partial<Record<ScopeFilter, number>>
}

function MasterSidebarScopeFilter({ value, onValueChange, counts }: ScopeFilterProps) {
  return (
    <div className="shrink-0 px-2 pt-2">
      <ResourceFilterTabs
        value={value}
        onValueChange={onValueChange}
        counts={counts}
        className="w-full"
      />
    </div>
  )
}

function MasterSidebarList({ children }: { children: ReactNode }) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-0.5 px-2 py-2">{children}</div>
    </ScrollArea>
  )
}

interface ItemProps {
  selected?: boolean
  onSelect?: () => void
  /** Slot before the label — small status dot, scope icon, etc. */
  leading?: ReactNode
  /** Slot after the label — small chip / count / scope. */
  trailing?: ReactNode
  /** Optional second line below the label — small chips, scope hints, etc.
   * Item height grows to accommodate, keeping label + trailing on the first
   * row so name and count get the full width. */
  subtitle?: ReactNode
  children: ReactNode
  className?: string
}

function MasterSidebarItem({
  selected,
  onSelect,
  leading,
  trailing,
  subtitle,
  children,
  className,
}: ItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-1.5 text-left text-sm transition-colors',
        'min-w-0',
        subtitle ? 'min-h-9 py-1' : 'h-9',
        selected
          ? 'bg-primary text-primary-foreground'
          : 'text-foreground/85 hover:bg-foreground/[0.05]',
        className,
      )}
    >
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate">{children}</span>
        {subtitle && <span className="flex items-center gap-1">{subtitle}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-1">{trailing}</span>}
    </button>
  )
}

interface IconTileProps {
  icon: LucideIcon
  /** Background tone — Tailwind palette class (e.g., `bg-purple-500`).
   * Brand identity colors live outside our token system on purpose. */
  tone: string
  /** Render the tile in a muted/disabled state. */
  muted?: boolean
  className?: string
}

/**
 * Square colored icon tile, used as the leading slot of a MasterSidebar
 * row. Mirrors the macOS Settings sidebar treatment so resource type
 * carries visual identity at a glance.
 */
export function SidebarIconTile({ icon: Icon, tone, muted, className }: IconTileProps) {
  return (
    <span
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-md shadow-sm',
        muted ? 'bg-muted-foreground/30' : tone,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 text-white" strokeWidth={2.25} />
    </span>
  )
}

function MasterSidebarEmpty({ children }: { children: ReactNode }) {
  return <div className="px-2 py-6 text-center text-xs text-muted-foreground/70">{children}</div>
}

MasterSidebar.Search = MasterSidebarSearch
MasterSidebar.ScopeFilter = MasterSidebarScopeFilter
MasterSidebar.List = MasterSidebarList
MasterSidebar.Item = MasterSidebarItem
MasterSidebar.Empty = MasterSidebarEmpty
