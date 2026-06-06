import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDialogStack } from '@/contexts/DialogStackContext'
import { useTags } from '@/hooks/useTags'
import { useUnreadCount } from '@/hooks/useUnread'
import { useWorkspaces } from '@/hooks/useWorkspaces'
import { getTagColor } from '@/lib/tag-colors'
import { cn } from '@/lib/utils'
import { Activity, Bell, ChevronsUpDown, LayoutGrid, Plus, Search } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

type Tone = 'running' | 'transient' | 'error' | 'stopped'

function runtimeTone(status: string | undefined): Tone {
  if (!status) return 'stopped'
  const s = status.toLowerCase()
  if (s.includes('error') || s.includes('fail')) return 'error'
  if (s === 'running') return 'running'
  if (s.includes('start') || s.includes('stopping') || s.includes('pending')) return 'transient'
  return 'stopped'
}

const TONE_DOT: Record<Tone, string> = {
  running: 'bg-success',
  transient: 'bg-warning',
  error: 'bg-destructive',
  stopped: 'bg-muted-foreground/30',
}

interface WsSwitcherProps {
  /** Current workspace id when in ws scope; omit in fleet scope. */
  workspaceId?: string
}

export function WsSwitcher({ workspaceId }: WsSwitcherProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { open: openDialog } = useDialogStack()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filterTagIds, setFilterTagIds] = useState<Set<string>>(new Set())
  const searchInputRef = useRef<HTMLInputElement>(null)

  const { data: workspaces } = useWorkspaces({ search: search.trim() || undefined })
  const { data: tags } = useTags()
  const current = workspaceId ? workspaces?.find((ws) => ws.id === workspaceId) : undefined
  const currentTone = runtimeTone(current?.status)
  // Aggregate across all workspaces, including the current one — the count
  // shouldn't jump when the user navigates between ws.
  const all = useUnreadCount({ kind: 'others' })

  const filteredWorkspaces = useMemo(() => {
    if (!workspaces) return undefined
    if (filterTagIds.size === 0) return workspaces
    return workspaces.filter((ws) => ws.tag_ids?.some((id) => filterTagIds.has(id)))
  }, [workspaces, filterTagIds])

  function handleSelect(targetWsId: string) {
    setOpen(false)
    setSearch('')
    setFilterTagIds(new Set())
    navigate(`/w/${targetWsId}`)
  }

  function handleFleet() {
    setOpen(false)
    setSearch('')
    setFilterTagIds(new Set())
    navigate('/')
  }

  function handleNewWorkspace() {
    setOpen(false)
    setSearch('')
    setFilterTagIds(new Set())
    openDialog('create-workspace')
  }

  function toggleTag(tagId: string) {
    setFilterTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-1.5">
        <PopoverTrigger
          className={cn(
            'group flex items-center gap-1.5 rounded-full px-2.5 py-1',
            'border border-foreground/[0.06] bg-foreground/[0.03]',
            'text-foreground transition-colors',
            'hover:border-foreground/[0.12] hover:bg-foreground/[0.06]',
            'data-[state=open]:border-foreground/[0.16] data-[state=open]:bg-foreground/[0.08]',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
          )}
        >
          {workspaceId ? (
            workspaces === undefined ? (
              // Initial fetch: show a stable skeleton so the trigger width
              // doesn't jump from `id` → real name on resolution.
              <>
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30"
                />
                <span
                  aria-hidden
                  className="inline-block h-3 w-28 shrink-0 rounded bg-foreground/[0.08]"
                />
              </>
            ) : (
              <>
                <span
                  aria-hidden
                  className={cn(
                    'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                    TONE_DOT[currentTone],
                  )}
                />
                <span className="max-w-[240px] truncate text-sm font-medium">
                  {current?.name ?? workspaceId}
                </span>
              </>
            )
          ) : (
            <>
              <LayoutGrid aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">
                {t('components.shell.wsSwitcher.allWorkspaces')}
              </span>
            </>
          )}
          <ChevronsUpDown
            aria-hidden
            className="h-3 w-3 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground"
          />
        </PopoverTrigger>
        {(all.human > 0 || all.agent > 0) && (
          <div className="inline-flex items-center gap-1">
            {all.human > 0 && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={t('components.shell.wsSwitcher.othersNeedYou', { count: all.human })}
                className={cn(
                  'group inline-flex items-center gap-1 rounded-full px-2 py-1 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-[3px]',
                  'bg-warning/15 text-warning hover:bg-warning/25 focus-visible:ring-warning/25',
                )}
              >
                <Bell aria-hidden className="h-3 w-3" />
                <span className="text-mini font-medium tabular-nums">{all.human}</span>
              </button>
            )}
            {all.agent > 0 && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={t('components.shell.wsSwitcher.othersRunning', { count: all.agent })}
                className={cn(
                  'group inline-flex items-center gap-1 rounded-full px-2 py-1 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-[3px]',
                  'bg-foreground/[0.06] text-muted-foreground hover:bg-foreground/[0.10] focus-visible:ring-ring/25',
                )}
              >
                <Activity aria-hidden className="h-3 w-3" />
                <span className="text-mini font-medium tabular-nums">{all.agent}</span>
              </button>
            )}
          </div>
        )}
      </div>
      <PopoverContent
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          searchInputRef.current?.focus()
        }}
        className="w-80 overflow-hidden rounded-xl p-0 shadow-lg"
      >
        <button
          type="button"
          onClick={handleFleet}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2 text-sm',
            'text-foreground transition-colors duration-200 ease-out',
            'hover:bg-foreground/[0.06]',
            'focus-visible:outline-none focus-visible:bg-foreground/[0.06]',
          )}
        >
          <LayoutGrid aria-hidden className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{t('components.shell.wsSwitcher.allWorkspaces')}</span>
        </button>

        <button
          type="button"
          onClick={handleNewWorkspace}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2 text-sm',
            'text-foreground transition-colors duration-200 ease-out',
            'hover:bg-foreground/[0.06]',
            'focus-visible:outline-none focus-visible:bg-foreground/[0.06]',
          )}
        >
          <Plus aria-hidden className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{t('components.shell.wsSwitcher.newWorkspace')}</span>
        </button>

        {tags && tags.length > 0 && (
          <>
            <div className="border-t border-border" />
            <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto px-2 py-2">
              {tags.map((tag) => {
                const color = getTagColor(tag.color)
                const active = filterTagIds.has(tag.id)
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-mini font-medium',
                      'transition-colors duration-150',
                      active
                        ? cn(color.bg, 'text-white shadow-sm')
                        : cn(color.text, 'hover:bg-foreground/[0.05]'),
                    )}
                  >
                    {tag.name}
                  </button>
                )
              })}
            </div>
          </>
        )}

        <div className="border-t border-border" />

        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('components.shell.wsSwitcher.searchPlaceholder')}
            className={cn(
              'w-full bg-transparent py-2 pl-9 pr-3 text-sm',
              'text-foreground placeholder:text-muted-foreground/60',
              'focus:outline-none',
            )}
          />
        </div>

        <div className="border-t border-border" />

        <div className="max-h-[60vh] overflow-y-auto p-1">
          {filteredWorkspaces && filteredWorkspaces.length > 0 ? (
            filteredWorkspaces.map((ws) => {
              const isCurrent = ws.id === workspaceId
              const tone = runtimeTone(ws.status)
              const isStopped = tone === 'stopped'
              const human = ws.active_human_sessions ?? 0
              const agent = ws.active_agent_sessions ?? 0
              return (
                <button
                  key={ws.id}
                  type="button"
                  onClick={() => handleSelect(ws.id)}
                  className={cn(
                    'relative flex w-full items-center justify-between gap-2',
                    'rounded-md py-2 pl-4 pr-2 text-left text-sm',
                    'transition-colors duration-200 ease-out',
                    'hover:bg-foreground/[0.06]',
                    'focus-visible:outline-none focus-visible:bg-foreground/[0.06]',
                    isStopped && 'text-muted-foreground/70',
                    isCurrent &&
                      cn(
                        'font-medium text-foreground',
                        'before:absolute before:left-1.5 before:top-1/2 before:h-5 before:w-[3px]',
                        'before:-translate-y-1/2 before:rounded-full',
                        'before:bg-gradient-to-b before:from-foreground/30 before:to-primary',
                      ),
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                        TONE_DOT[tone],
                      )}
                    />
                    <span className="truncate">{ws.name}</span>
                  </span>
                  {(human > 0 || agent > 0) && (
                    <span className="inline-flex shrink-0 items-center gap-1">
                      {human > 0 && (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1',
                            'rounded-full px-1.5 py-0 text-mini font-medium tabular-nums',
                            'bg-warning/15 text-warning',
                          )}
                        >
                          <Bell aria-hidden className="h-2.5 w-2.5" />
                          {human}
                        </span>
                      )}
                      {agent > 0 && (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1',
                            'rounded-full px-1.5 py-0 text-mini font-medium tabular-nums',
                            'bg-foreground/[0.06] text-muted-foreground',
                          )}
                        >
                          <Activity aria-hidden className="h-2.5 w-2.5" />
                          {agent}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              )
            })
          ) : (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              {t('components.shell.wsSwitcher.noResults')}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
