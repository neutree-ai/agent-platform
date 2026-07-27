import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSessionFacets } from '@/hooks/useSessions'
import {
  EMPTY_SESSION_FILTER,
  SESSION_STATUS_BUCKETS,
  SESSION_TIME_WINDOWS,
  type SessionFilter,
  type SessionStatusBucket,
  type SessionTimeWindow,
  activeFacetCount,
  normalizeStatuses,
} from '@/lib/session-filter'
import { sortSources, sourceVisual } from '@/lib/session-source'
import { cn } from '@/lib/utils'
import { Filter, Star } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface SessionFilterMenuProps {
  workspaceId: string
  filter: SessionFilter
  onChange: (next: SessionFilter) => void
}

/** Keeps the menu open when a facet is toggled, so several can be set in one visit. */
const keepOpen = (e: Event) => e.preventDefault()

/**
 * Filter entry for the session list: one button, one menu, facets in
 * submenus. The parent menu stays visible while a submenu is open, so
 * switching facets is a horizontal move rather than a back-and-forth, and it
 * doesn't grow taller as connector types are added.
 *
 * Active state is a numeric badge — how many facets deviate from the default.
 * A generated summary ("hiding scheduled and 2 others") would need
 * per-language pluralization and inverted phrasing for an exclusion-based
 * filter; a number needs neither and stays correct as facets are added.
 */
export function SessionFilterMenu({ workspaceId, filter, onChange }: SessionFilterMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // Counts describe the whole workspace, so they're only worth fetching while
  // the menu is on screen.
  const { data: facets } = useSessionFacets(workspaceId, open)

  const count = activeFacetCount(filter)
  const knownSources = sortSources(Object.keys(facets?.source ?? {}))

  const toggleSource = (source: string, keep: boolean) => {
    const excluded = new Set(filter.excludedSources)
    if (keep) excluded.delete(source)
    else excluded.add(source)
    onChange({ ...filter, excludedSources: [...excluded] })
  }

  const toggleStatus = (status: SessionStatusBucket, keep: boolean) => {
    // Empty means "all", so an untouched filter starts from the full set the
    // moment the user unchecks their first status.
    const current = filter.statuses.length ? filter.statuses : SESSION_STATUS_BUCKETS
    const next = keep ? [...current, status] : current.filter((s) => s !== status)
    onChange({ ...filter, statuses: normalizeStatuses(next) })
  }

  const facetSummary = (kept: number, total: number) =>
    kept === total ? t('components.sessions.filter.all') : `${kept}/${total}`

  const statusesKept = filter.statuses.length || SESSION_STATUS_BUCKETS.length

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={
            count > 0
              ? t('components.sessions.filter.activeLabel', { count })
              : t('components.sessions.filter.title')
          }
          title={t('components.sessions.filter.title')}
          className={cn(
            'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
            count > 0 || open
              ? 'bg-primary/15 text-primary'
              : 'bg-foreground/[0.04] text-muted-foreground/70 hover:bg-foreground/[0.07] hover:text-foreground',
          )}
        >
          <Filter className="h-3.5 w-3.5" strokeWidth={2} />
          {count > 0 && (
            <span className="-top-1 -right-1 absolute flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 font-bold text-[9px] text-primary-foreground tabular-nums ring-2 ring-card">
              {count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span>{t('components.sessions.filter.source')}</span>
            <span className="ml-auto text-muted-foreground text-xs tabular-nums">
              {facetSummary(
                knownSources.length - filter.excludedSources.length,
                knownSources.length,
              )}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            {knownSources.map((source) => {
              const { Icon, labelKey } = sourceVisual(source)
              return (
                <DropdownMenuCheckboxItem
                  key={source}
                  className="gap-2"
                  checked={!filter.excludedSources.includes(source)}
                  onCheckedChange={(keep) => toggleSource(source, keep === true)}
                  onSelect={keepOpen}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                  <span className="truncate">{t(`components.sessions.source.${labelKey}`)}</span>
                  <span className="ml-auto text-muted-foreground text-xs tabular-nums">
                    {facets?.source[source] ?? 0}
                  </span>
                </DropdownMenuCheckboxItem>
              )
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span>{t('components.sessions.filter.status')}</span>
            <span className="ml-auto text-muted-foreground text-xs tabular-nums">
              {facetSummary(statusesKept, SESSION_STATUS_BUCKETS.length)}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            {SESSION_STATUS_BUCKETS.map((status) => (
              <DropdownMenuCheckboxItem
                key={status}
                checked={!filter.statuses.length || filter.statuses.includes(status)}
                onCheckedChange={(keep) => toggleStatus(status, keep === true)}
                onSelect={keepOpen}
              >
                <span className="truncate">
                  {t(`components.sessions.filter.statusValue.${status}`)}
                </span>
                <span className="ml-auto text-muted-foreground text-xs tabular-nums">
                  {facets?.status[status] ?? 0}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span>{t('components.sessions.filter.time')}</span>
            <span className="ml-auto text-muted-foreground text-xs">
              {t(`components.sessions.filter.timeValue.${filter.time}`)}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            <DropdownMenuRadioGroup
              value={filter.time}
              onValueChange={(value) => onChange({ ...filter, time: value as SessionTimeWindow })}
            >
              {SESSION_TIME_WINDOWS.map((window) => (
                <DropdownMenuRadioItem key={window} value={window} onSelect={keepOpen}>
                  {t(`components.sessions.filter.timeValue.${window}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuCheckboxItem
          className="gap-2"
          checked={filter.starredOnly}
          onCheckedChange={(next) => onChange({ ...filter, starredOnly: next === true })}
          onSelect={keepOpen}
        >
          <Star className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
          <span className="truncate">{t('components.sessions.filterStarred')}</span>
          <span className="ml-auto text-muted-foreground text-xs tabular-nums">
            {facets?.starred ?? 0}
          </span>
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={count === 0}
          onSelect={() => onChange({ ...EMPTY_SESSION_FILTER })}
        >
          {t('components.sessions.filter.clear')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
