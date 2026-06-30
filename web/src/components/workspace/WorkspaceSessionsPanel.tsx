import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { ShareSessionButton } from '@/components/workspace/ShareSessionButton'
import { sessionKeys, useInvalidateSessions, useSessions } from '@/hooks/useSessions'
import { useMarkSeen, useUnreadCount } from '@/hooks/useUnread'
import { api } from '@/lib/api/client'
import type { Session } from '@/lib/api/types'
import { isCommitEnter } from '@/lib/keyboard'
import { formatFullTime, formatRelativeTime } from '@/lib/relative-time'
import { cleanSessionPreview } from '@/lib/session-utils'
import { cn } from '@/lib/utils'
import { useActiveSession } from '@/stores/active-session-store'
import { useInstanceState } from '@/stores/instance-state-store'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  CalendarClock,
  Check,
  CheckCheck,
  Globe,
  type LucideIcon,
  MessageCircle,
  Pencil,
  Search,
  Share2,
  Slack,
  SquarePen,
  Star,
  Trash2,
  Webhook,
  X,
} from 'lucide-react'
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type SessionStatus = 'running' | 'needs-you' | 'error' | 'idle'

function classifyStatus(chatStatus: string): SessionStatus {
  // chat_status from cp is one of: 'agent' (agent running), 'human' (waiting
  // for user), 'idle'. Error states are surfaced via other channels for now.
  const s = chatStatus.toLowerCase()
  if (s === 'human') return 'needs-you'
  if (s === 'agent') return 'running'
  if (s.includes('error') || s.includes('fail')) return 'error'
  return 'idle'
}

// Per-source leading icon. Every row carries one so titles stay left-aligned.
// Literal switch (not `icons[source]`) keeps each source greppable and lets
// new connector types fail loudly into the muted fallback.
function sourceVisual(source: string): { Icon: LucideIcon; labelKey: string } {
  switch (source) {
    case 'schedule':
      return { Icon: CalendarClock, labelKey: 'schedule' }
    case 'slack':
      return { Icon: Slack, labelKey: 'slack' }
    case 'wecom':
      return { Icon: MessageCircle, labelKey: 'wecom' }
    case 'webhook':
      return { Icon: Webhook, labelKey: 'webhook' }
    case 'agent':
      return { Icon: Bot, labelKey: 'agent' }
    default:
      // 'web' (manual) and any unknown source.
      return { Icon: Globe, labelKey: 'web' }
  }
}

type Bucket = 'today' | 'week' | 'month' | 'earlier'

function bucketOf(iso: string, now: number): Bucket {
  const ts = new Date(iso).getTime()
  const days = (now - ts) / 86_400_000
  // Use local-day boundary for "today" rather than 24h rolling window so
  // "yesterday at 11pm" doesn't show as "today" at 1am.
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (ts >= today.getTime()) return 'today'
  if (days < 7) return 'week'
  if (days < 30) return 'month'
  return 'earlier'
}

interface SessionRowProps {
  session: Session
  active: boolean
  shareCount: number
  renaming: boolean
  onSelect: () => void
  onStartRename: () => void
  onCommitRename: (next: string) => Promise<void>
  onCancelRename: () => void
  onShare: () => void
  onDelete: () => void
  onMarkSeen: () => void
  onToggleStar: () => void
}

function SessionRow({
  session,
  active,
  shareCount,
  renaming,
  onSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onShare,
  onDelete,
  onMarkSeen,
  onToggleStar,
}: SessionRowProps) {
  const { t, i18n } = useTranslation()
  const status = classifyStatus(session.chat_status)
  const starred = !!session.starred_at
  const { Icon: SourceIcon, labelKey: sourceLabelKey } = sourceVisual(session.source)
  const sourceLabel = t(`components.sessions.source.${sourceLabelKey}`)
  const relTime = useMemo(
    () => formatRelativeTime(session.created_at, i18n.language),
    [session.created_at, i18n.language],
  )
  const fullTime = useMemo(
    () => formatFullTime(session.created_at, i18n.language),
    [session.created_at, i18n.language],
  )
  const previewTitle = useMemo(
    () => (session.preview ? cleanSessionPreview(session.preview) : ''),
    [session.preview],
  )
  const [draft, setDraft] = useState(session.name || previewTitle)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) {
      setDraft(session.name || previewTitle)
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [renaming, session.name, previewTitle])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isCommitEnter(e)) {
      e.preventDefault()
      onCommitRename(draft.trim())
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancelRename()
    }
  }

  const [deleteArmed, setDeleteArmed] = useState(false)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
    },
    [],
  )

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (deleteArmed) {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
      setDeleteArmed(false)
      onDelete()
    } else {
      setDeleteArmed(true)
      deleteTimerRef.current = setTimeout(() => setDeleteArmed(false), 3000)
    }
  }

  const titleNode = renaming ? (
    <Input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommitRename(draft.trim())}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      className="h-6 px-1.5 py-0 text-xs"
    />
  ) : (
    <div className="min-w-0">
      <div
        className={cn(
          'truncate text-xs',
          active ? 'font-medium text-foreground' : 'text-foreground',
        )}
      >
        {session.name || previewTitle || t('components.sessions.untitled')}
      </div>
    </div>
  )

  const containerClass = cn(
    'group relative flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left transition-colors',
    // Active row: primary-tinted fill + a left accent bar so the selection
    // reads at a glance against the dense list. Hover stays a neutral wash.
    active
      ? 'bg-primary/[0.12] before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary'
      : 'hover:bg-foreground/[0.04]',
  )

  const statusNode = (() => {
    if (status === 'running') {
      return (
        <span
          className="relative inline-flex h-2 w-2 shrink-0"
          aria-label={t('components.sessions.status.running')}
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
      )
    }
    if (status === 'needs-you') {
      return (
        <span
          className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-warning/80"
          aria-label={t('components.sessions.status.needsYou')}
        />
      )
    }
    if (status === 'error') {
      return (
        <span
          className="inline-flex h-2 w-2 shrink-0 rounded-full bg-destructive"
          aria-label={t('components.sessions.status.error')}
        />
      )
    }
    if (shareCount > 0) {
      return (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-mini text-info/70">
          <Share2 className="h-2.5 w-2.5" strokeWidth={2} />
          {shareCount}
        </span>
      )
    }
    return null
  })()

  const inner = (
    <>
      <SourceIcon
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
        strokeWidth={2}
        aria-label={sourceLabel}
      >
        <title>{sourceLabel}</title>
      </SourceIcon>
      <div className="min-w-0 flex-1">{titleNode}</div>
      {starred && (
        <Star
          className="h-3 w-3 shrink-0 fill-warning text-warning"
          strokeWidth={2}
          aria-label={t('components.sessions.starred')}
        />
      )}
      {statusNode && <div className="shrink-0">{statusNode}</div>}
    </>
  )

  if (renaming) {
    return <div className={containerClass}>{inner}</div>
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: contains nested interactive descendants (rename input, dropdown), so cannot be a real <button>
    <div
      role="button"
      tabIndex={0}
      data-session-id={session.id}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        containerClass,
        'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
      )}
    >
      {inner}
      <div
        className={cn(
          'absolute right-0 top-0 bottom-0 flex items-center gap-0 pl-2 pr-2',
          'opacity-0 transition-opacity duration-150',
          'group-hover:opacity-100 focus-within:opacity-100',
          // Solid card behind the date + actions so the date stays legible, with
          // a short gradient lead-in strip to the left so it doesn't hard-cut
          // the title underneath.
          'bg-card',
          'before:pointer-events-none before:absolute before:right-full before:inset-y-0 before:w-8 before:bg-gradient-to-l before:from-card before:to-transparent',
        )}
      >
        {relTime && (
          <span
            className="mr-1.5 shrink-0 whitespace-nowrap text-mini text-muted-foreground/70"
            title={fullTime}
          >
            {relTime}
          </span>
        )}
        {status === 'needs-you' && (
          <button
            type="button"
            aria-label={t('components.sessions.markSeen')}
            onClick={(e) => {
              e.stopPropagation()
              onMarkSeen()
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
          >
            <CheckCheck className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          aria-label={starred ? t('components.sessions.unstar') : t('components.sessions.star')}
          onClick={(e) => {
            e.stopPropagation()
            onToggleStar()
          }}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded transition-colors',
            starred
              ? 'text-warning hover:bg-warning/15'
              : 'text-muted-foreground/60 hover:bg-foreground/[0.08] hover:text-warning',
          )}
        >
          <Star className={cn('h-3.5 w-3.5', starred && 'fill-current')} strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label={t('components.sessions.rename')}
          onClick={(e) => {
            e.stopPropagation()
            onStartRename()
          }}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label={t('components.sessions.share')}
          onClick={(e) => {
            e.stopPropagation()
            onShare()
          }}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
        >
          <Share2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label={t('components.sessions.delete')}
          onClick={handleDeleteClick}
          className={cn(
            'flex h-6 items-center justify-center rounded transition-colors',
            deleteArmed
              ? 'gap-1 bg-destructive/15 px-1.5 text-destructive'
              : 'w-6 text-muted-foreground/60 hover:bg-destructive/15 hover:text-destructive',
          )}
        >
          {deleteArmed ? (
            <>
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
              <span className="text-mini font-medium">{t('common.confirm')}</span>
            </>
          ) : (
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          )}
        </button>
      </div>
    </div>
  )
}

interface WorkspaceSessionsPanelProps {
  workspaceId: string
  instanceId: string
}

export function WorkspaceSessionsPanel({ workspaceId, instanceId }: WorkspaceSessionsPanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const headerSlot = useAppHeaderSlot()
  // Starred-only filter. Memory instance state — survives a layout switch but
  // resets on refresh, so reopening the panel always shows the full list.
  const [starredOnly, setStarredOnly] = useInstanceState<boolean>(
    instanceId,
    'starredOnly',
    () => false,
  )
  const {
    data: sessions,
    isLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useSessions(workspaceId, { starred: starredOnly })
  const invalidateSessions = useInvalidateSessions()
  const activeSessionId = useActiveSession((s) =>
    s.workspaceId === workspaceId ? s.sessionId : undefined,
  )

  const { data: shares } = useQuery({
    queryKey: ['workspace-shares', workspaceId],
    queryFn: () => api.getWorkspaceShares(workspaceId),
    enabled: !!workspaceId,
    staleTime: 30_000,
  })

  const shareCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const share of shares ?? []) {
      if (!share.session_id) continue
      counts.set(share.session_id, (counts.get(share.session_id) ?? 0) + 1)
    }
    return counts
  }, [shares])

  // In-memory instance state — survives layout switch but not refresh.
  const [query, setQuery] = useInstanceState<string>(instanceId, 'query', () => '')
  const [renamingId, setRenamingId] = useInstanceState<string | null>(
    instanceId,
    'renamingId',
    () => null,
  )

  // Component-local — purely transient dialog toggle.
  const [shareSessionId, setShareSessionId] = useState<string | null>(null)

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((s) => {
      const haystack = `${s.name ?? ''} ${s.preview ?? ''}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [sessions, query])

  // Group sessions into time buckets. Sessions are already sorted desc by
  // last_active_at; we just walk and emit a header when the bucket changes.
  const grouped = useMemo(() => {
    const now = Date.now()
    const out: Array<{ bucket: Bucket; sessions: Session[] }> = []
    let current: { bucket: Bucket; sessions: Session[] } | null = null
    for (const s of filteredSessions) {
      const b = bucketOf(s.last_active_at, now)
      if (!current || current.bucket !== b) {
        current = { bucket: b, sessions: [] }
        out.push(current)
      }
      current.sessions.push(s)
    }
    return out
  }, [filteredSessions])

  const handleSelect = useCallback(
    (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId)
      useActiveSession.getState().switchTo(
        workspaceId,
        sessionId,
        session
          ? {
              sessionChatStatus: session.chat_status,
              lastTurnStats: session.last_turn_stats,
            }
          : undefined,
      )
    },
    [sessions, workspaceId],
  )

  const handleCommitRename = useCallback(
    async (sessionId: string, next: string) => {
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) {
        setRenamingId(null)
        return
      }
      const trimmed = next.trim()
      if (!trimmed || trimmed === session.name) {
        setRenamingId(null)
        return
      }
      try {
        await api.renameSession(workspaceId, sessionId, trimmed)
        invalidateSessions(workspaceId)
        toast.success(t('components.sessions.toasts.renamed'))
      } catch (err) {
        toast.error((err as Error).message)
      } finally {
        setRenamingId(null)
      }
    },
    [sessions, workspaceId, invalidateSessions, t, setRenamingId],
  )

  const handleDelete = useCallback(
    async (session: Session) => {
      try {
        await api.deleteSession(workspaceId, session.id)
        invalidateSessions(workspaceId)
        if (activeSessionId === session.id) {
          useActiveSession.getState().switchTo(workspaceId, undefined)
        }
        toast.success(t('components.sessions.toasts.deleted'))
      } catch (err) {
        toast.error((err as Error).message)
      }
    },
    [workspaceId, activeSessionId, invalidateSessions, t],
  )

  const handleToggleStar = useCallback(
    async (session: Session) => {
      const next = !session.starred_at
      const key = sessionKeys.listVariant(workspaceId, starredOnly)
      // Optimistic: flip the flag in cache so the star reacts instantly. When
      // the starred-only filter is on, un-starring drops the row outright.
      await queryClient.cancelQueries({ queryKey: key })
      const prev = queryClient.getQueryData(key)
      queryClient.setQueryData(key, (old: any) => {
        if (!old?.pages) return old
        return {
          ...old,
          pages: old.pages.map((p: any) => ({
            ...p,
            items:
              starredOnly && !next
                ? p.items.filter((s: Session) => s.id !== session.id)
                : p.items.map((s: Session) =>
                    s.id === session.id
                      ? {
                          ...s,
                          starred_at: next ? new Date().toISOString() : null,
                        }
                      : s,
                  ),
          })),
        }
      })
      try {
        await api.setSessionStarred(workspaceId, session.id, next)
      } catch (err) {
        queryClient.setQueryData(key, prev)
        toast.error((err as Error).message)
      } finally {
        invalidateSessions(workspaceId)
      }
    },
    [workspaceId, starredOnly, queryClient, invalidateSessions],
  )

  const { human: unreadCount } = useUnreadCount({ kind: 'ws', workspaceId })
  const markSeen = useMarkSeen()

  const handleMarkAllRead = useCallback(async () => {
    try {
      await markSeen.mutateAsync({ workspaceId })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }, [workspaceId, markSeen])

  // Locate the first session waiting on the user, select it, and scroll it
  // into view. Wired to the "N needs you" label so clicking it no longer
  // dismisses everything — that's now the separate Mark-all-read button.
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const handleLocateUnread = useCallback(() => {
    const target = filteredSessions.find((s) => s.chat_status === 'human')
    if (!target) return
    handleSelect(target.id)
    requestAnimationFrame(() => {
      scrollContainerRef.current
        ?.querySelector(`[data-session-id="${target.id}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
  }, [filteredSessions, handleSelect])

  const handleMarkSeen = useCallback(
    async (sessionId: string) => {
      try {
        await markSeen.mutateAsync({ workspaceId, sessionId })
      } catch (err) {
        toast.error((err as Error).message)
      }
    },
    [workspaceId, markSeen],
  )

  // Infinite-scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasNextPage || query) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage()
      },
      { rootMargin: '120px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, query])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* New-session — primary action, projected into the AppWindow header. */}
      {headerSlot &&
        createPortal(
          <AppHeaderButton
            icon={SquarePen}
            label={t('components.sidebar.sessions.newSession')}
            onClick={() => useActiveSession.getState().switchTo(workspaceId, undefined)}
          />,
          headerSlot,
        )}

      {/* Search + starred filter — one full-width row in the panel body. */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-foreground/[0.06] p-2">
        <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-foreground/[0.04] px-2 transition-colors focus-within:bg-foreground/[0.06]">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" strokeWidth={2} />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('components.sessions.searchPlaceholder')}
            className="h-5 border-0 bg-transparent px-0 py-0 text-xs shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0"
          />
          {query && (
            <button
              type="button"
              aria-label={t('common.clear')}
              onClick={() => setQuery('')}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          )}
        </div>
        <button
          type="button"
          aria-label={t('components.sessions.filterStarred')}
          title={t('components.sessions.filterStarred')}
          aria-pressed={starredOnly}
          onClick={() => setStarredOnly(!starredOnly)}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
            starredOnly
              ? 'bg-warning/15 text-warning'
              : 'bg-foreground/[0.04] text-muted-foreground/70 hover:bg-foreground/[0.07] hover:text-foreground',
          )}
        >
          <Star className={cn('h-3.5 w-3.5', starredOnly && 'fill-current')} strokeWidth={2} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          <Spinner size="sm" className="mr-1.5" />
          {t('common.loading')}
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyHero
            illustration={<EmptyIllustration src={query ? 'search' : 'sessions'} size="h-32" />}
            title={
              query
                ? t('components.sessions.noMatch.title')
                : starredOnly
                  ? t('components.sessions.starredEmpty.title')
                  : t('components.sessions.empty.title')
            }
            description={
              query
                ? t('components.sessions.noMatch.description')
                : starredOnly
                  ? t('components.sessions.starredEmpty.description')
                  : t('components.sessions.empty.description')
            }
          />
        </div>
      ) : (
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
          {unreadCount > 0 && !query && (
            <div className="flex w-full items-center justify-between gap-2 py-1 pr-1.5 pl-3">
              <button
                type="button"
                onClick={handleLocateUnread}
                title={t('components.sessions.locateUnread')}
                className="inline-flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-xs text-muted-foreground/80 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
              >
                <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-warning/80" />
                <span className="truncate">
                  {t('components.sessions.unreadCount', { count: unreadCount })}
                </span>
              </button>
              <button
                type="button"
                onClick={handleMarkAllRead}
                title={t('components.sessions.markAllRead')}
                className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-mini text-muted-foreground/70 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
              >
                <CheckCheck className="h-3 w-3" strokeWidth={2} />
                {t('components.sessions.markAllRead')}
              </button>
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.bucket}>
              <div className="sticky top-0 z-10 bg-card/95 px-3 pt-2 pb-1 text-mini font-medium uppercase tracking-wide text-muted-foreground/50 backdrop-blur">
                {t(`components.sessions.groups.${group.bucket}`)}
              </div>
              {group.sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  active={session.id === activeSessionId}
                  shareCount={shareCounts.get(session.id) ?? 0}
                  renaming={renamingId === session.id}
                  onSelect={() => handleSelect(session.id)}
                  onStartRename={() => setRenamingId(session.id)}
                  onCommitRename={(next) => handleCommitRename(session.id, next)}
                  onCancelRename={() => setRenamingId(null)}
                  onShare={() => setShareSessionId(session.id)}
                  onDelete={() => handleDelete(session)}
                  onMarkSeen={() => handleMarkSeen(session.id)}
                  onToggleStar={() => handleToggleStar(session)}
                />
              ))}
            </div>
          ))}
          {!query && (
            <>
              <div ref={sentinelRef} className="h-4" />
              {isFetchingNextPage && (
                <div className="flex items-center justify-center py-2 text-mini text-muted-foreground">
                  <Spinner size="sm" className="mr-1" />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {shareSessionId && (
        <ShareSessionButton
          workspaceId={workspaceId}
          sessionId={shareSessionId}
          controlled={{
            open: true,
            onOpenChange: (next) => {
              if (!next) {
                setShareSessionId(null)
                queryClient.invalidateQueries({
                  queryKey: ['workspace-shares', workspaceId],
                })
              }
            },
          }}
        />
      )}
    </div>
  )
}
