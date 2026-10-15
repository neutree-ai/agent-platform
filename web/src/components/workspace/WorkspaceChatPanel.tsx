import { TranscriptProviders } from '@/components/chat/TranscriptProviders'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShareSessionButton } from '@/components/workspace/ShareSessionButton'
import { useAuth } from '@/contexts/AuthContext'
import { useSlotContext } from '@/contexts/SlotContext'
import { useAgentInfo } from '@/hooks/useAgentInfo'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { useChatSearch } from '@/hooks/useChatSearch'
import { useChatSendKey } from '@/hooks/useChatSendKey'
import { useSessionSource } from '@/hooks/useSessionSource'
import { useInvalidateSessions, useSessions } from '@/hooks/useSessions'
import { useMarkSeen } from '@/hooks/useUnread'
import { useWorkspaceComposer } from '@/hooks/useWorkspaceComposer'
import { api } from '@/lib/api/client'
import type { ChatImageAttachment, Session, Workspace } from '@/lib/api/types'
import { i18n as appI18n } from '@/lib/i18n'
import { isCommitEnter } from '@/lib/keyboard'
import { cleanSessionPreview } from '@/lib/session-utils'
import { useAgentSessionActions, useAgentSessionStore } from '@/stores/AgentSessionContext'
import type { ChatMessage as ChatMessageType } from '@/stores/agent-session-store'
import { useComposerInsertRequests } from '@/stores/composer-store'
import { useDraft } from '@/stores/draft-store'
import {
  AskUserQuestionPanel,
  Composer,
  type ComposerHandle,
  MessageBubble,
  TranscriptI18nProvider,
  TurnStatsBar,
  WaitingOnAgentsNotice,
  useRemoteTurnSync,
} from '@neutree-ai/ui-sdk'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Bot,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Shrink,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { I18nextProvider, useTranslation } from 'react-i18next'

const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 18

const FONT_SIZE_STEP = 2
const FONT_SIZE_DEFAULT = 12

/** Sentinel that triggers a callback when scrolled into view (infinite load). */
function LoadMoreSentinel({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onVisible()
      },
      { threshold: 0.1 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [onVisible])
  return (
    <div
      ref={ref}
      className="flex items-center justify-center py-1 text-mini text-muted-foreground"
    >
      <Spinner size="sm" />
    </div>
  )
}

function formatRelativeTime(
  dateStr: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffSec = Math.round((now - then) / 1000)
  if (diffSec < 60) return t('components.workspaceChat.relativeTime.justNow')
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60)
    return t('components.workspaceChat.relativeTime.minutesAgo', {
      count: diffMin,
    })
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24)
    return t('components.workspaceChat.relativeTime.hoursAgo', {
      count: diffHr,
    })
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay === 1) return t('components.workspaceChat.relativeTime.yesterday')
  if (diffDay < 30)
    return t('components.workspaceChat.relativeTime.daysAgo', {
      count: diffDay,
    })
  return new Date(dateStr).toLocaleDateString()
}

function formatSessionLabel(
  session: Session,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const label = session.name
    ? session.name
    : session.preview
      ? (() => {
          const c = cleanSessionPreview(session.preview)
          return c.slice(0, 40) + (c.length > 40 ? '...' : '')
        })()
      : t('components.sidebar.sessions.newSession')
  const time = session.last_active_at ? formatRelativeTime(session.last_active_at, t) : ''
  return time ? `${label} · ${time}` : label
}

function HintBar({ visible, hints }: { visible: boolean; hints: string[] }) {
  const [index, setIndex] = useState(0)
  const [fade, setFade] = useState(true)

  useEffect(() => {
    if (!visible) return
    setIndex(Math.floor(Math.random() * hints.length))
    setFade(true)
  }, [visible, hints])

  useEffect(() => {
    if (!visible) return
    const interval = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setIndex((i) => (i + 1) % hints.length)
        setFade(true)
      }, 200)
    }, 6000)
    return () => clearInterval(interval)
  }, [visible, hints])

  if (!visible) return null

  return (
    <div className="px-3 pb-1">
      <div
        className={`text-center text-tiny text-muted-foreground/60 transition-opacity duration-200 ${fade ? 'opacity-100' : 'opacity-0'}`}
      >
        {hints[index]}
      </div>
    </div>
  )
}

interface WorkspaceChatPanelProps {
  workspace: Workspace
  /**
   * Optional transform applied to the user's text on the first message of a
   * new session (when there's no `activeSessionId` yet). Lets embedders
   * prepend context — e.g., teamwork's `[TEAMWORK CONTEXT]` block — without
   * surfacing a separate UI step. Receives the raw input (may be `' '`),
   * returns the final string to send.
   */
  transformFirstMessage?: (text: string) => string
  /**
   * Read-only mode: hides the input form and the header-portal controls
   * (session switcher, rename / interrupt menu). Use when embedding the
   * panel as a viewer for someone else's session — e.g., teamwork showing
   * a member-agent session driven by the coordinator.
   */
  readonly?: boolean
  /**
   * Fired whenever the rendered message list changes. Lets external observers
   * (e.g., teamwork's member-session detector) parse tool calls without
   * needing their own session subscription.
   */
  onMessages?: (messages: ChatMessageType[]) => void
}

export function WorkspaceChatPanel({
  workspace,
  transformFirstMessage,
  readonly = false,
  onMessages,
}: WorkspaceChatPanelProps) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  // Several people speak in a shared workspace's sessions: label the user
  // messages that are not the viewer's own with their author.
  const multiAuthor = workspace.is_shared || workspace.access === 'shared'
  const showAuthorOf = (msg: ChatMessageType) =>
    multiAuthor && !!msg.author && msg.author.id !== user?.id
  const { mode: chatSendKeyMode } = useChatSendKey()
  // ── Store ──
  const activeSessionId = useAgentSessionStore((s) => s.activeSessionId)
  const messages = useAgentSessionStore((s) => s.messages)
  const isLoading = useAgentSessionStore((s) => s.isLoading)
  const isSwitching = useAgentSessionStore((s) => s.isSwitching)
  const isDeleting = useAgentSessionStore((s) => s.isDeleting)
  const error = useAgentSessionStore((s) => s.error)
  const pendingQuestion = useAgentSessionStore((s) => s.pendingQuestion)
  const pendingMessage = useAgentSessionStore((s) => s.pendingMessage)
  const returnedDraft = useAgentSessionStore((s) => s.returnedDraft)
  const lastTurnStats = useAgentSessionStore((s) => s.lastTurnStats)
  const actions = useAgentSessionActions()

  // ── Session list ──
  const { data: sessions = [], fetchNextPage, hasNextPage } = useSessions(workspace.id)
  const invalidateSessions = useInvalidateSessions()
  const markSeen = useMarkSeen()

  // Agent calls the open session is still waiting on. Read from the session
  // list, which is refreshed whenever a turn ends.
  const pendingAgentCalls = sessions.find((s) => s.id === activeSessionId)?.pending_agent_calls ?? 0
  const waitingOnAgents = pendingAgentCalls > 0

  // Turns this tab did not start don't reach its stream: other people's in a
  // shared workspace, and the one the platform starts to deliver the results
  // of agent calls. Poll the active session to pick them up while the tab is
  // visible.
  useRemoteTurnSync({
    enabled: !readonly && (multiAuthor || waitingOnAgents),
    syncRemoteTurn: actions.syncRemoteTurn,
    // A call can also close without a turn here (its result read another
    // way, or dropped), so the count is re-read rather than inferred.
    onTick: waitingOnAgents ? () => invalidateSessions(workspace.id) : undefined,
  })

  const isChatBusy = isLoading || isDeleting
  const isSessionLocked = isDeleting || isSwitching

  // Auto-mark `human` sessions as seen once the user opens them. Guard with a
  // ref so we only fire once per (session, status) pair — repeated renders or
  // SSE-driven re-fetches must not spam the endpoint.
  const lastMarkedSeenRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeSessionId || isSwitching) return
    const session = sessions.find((s) => s.id === activeSessionId)
    if (!session || session.chat_status !== 'human') {
      // Reset guard when the session leaves 'human' so a future flip can mark again.
      if (lastMarkedSeenRef.current === activeSessionId) {
        lastMarkedSeenRef.current = null
      }
      return
    }
    if (lastMarkedSeenRef.current === activeSessionId) return
    lastMarkedSeenRef.current = activeSessionId
    markSeen.mutate(
      { workspaceId: workspace.id, sessionId: activeSessionId },
      {
        onError: () => {
          // Best-effort; allow a retry next time the user revisits.
          if (lastMarkedSeenRef.current === activeSessionId) {
            lastMarkedSeenRef.current = null
          }
        },
      },
    )
  }, [activeSessionId, isSwitching, sessions, workspace.id, markSeen])

  // ── Local UI state ──
  const { draft: input, setDraft: setInput, clearDraft } = useDraft(workspace.id, activeSessionId)
  const [attachedImages, setAttachedImages] = useState<ChatImageAttachment[]>([])
  const composerRef = useRef<ComposerHandle>(null)
  const { agentInfo } = useAgentInfo(workspace.id)
  const agentType = agentInfo?.agent_type ?? 'claude-code'
  const composerSources = useWorkspaceComposer(workspace.id, agentType)
  // Offered only when the agent core can run it; the preset decides.
  const compactCommand = composerSources.commands.find((c) => c.name === 'compact')
  const canCompact = !!compactCommand
  const hints = useMemo(
    () => [
      t('components.workspaceChat.hints.customCommands'),
      t(
        chatSendKeyMode === 'enter'
          ? 'components.workspaceChat.hints.sendMessageEnter'
          : 'components.workspaceChat.hints.sendMessage',
      ),
      t('components.workspaceChat.hints.searchConversation'),
      t('components.workspaceChat.hints.configureCommands'),
      ...(canCompact ? [t('components.workspaceChat.hints.compactConversation')] : []),
    ],
    [t, chatSendKeyMode, canCompact],
  )
  const headerSlot = useAppHeaderSlot()
  const slotCtx = useSlotContext()
  const sessionsAppOpened = useMemo(
    () =>
      slotCtx?.slots.some((s) =>
        slotCtx.getState(s.id).opened.some((i) => i.appId === 'sessions'),
      ) ?? false,
    [slotCtx],
  )

  // Session source (channel origin)
  const { data: sessionSource } = useSessionSource(activeSessionId)

  // Agent-to-agent origin: the agent that invoked this session via `call_agent`.
  const callerAgent = useMemo(
    () => sessions.find((s) => s.id === activeSessionId)?.caller_agent ?? null,
    [sessions, activeSessionId],
  )

  // Session rename
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  const startRename = useCallback(() => {
    if (!activeSessionId) return
    const session = sessions.find((s) => s.id === activeSessionId)
    if (!session) return
    setRenameValue(session.name || '')
    setRenameOpen(true)
  }, [activeSessionId, sessions])

  const commitRename = useCallback(async () => {
    if (!activeSessionId || !renameValue.trim()) {
      setRenameOpen(false)
      return
    }
    try {
      await api.renameSession(workspace.id, activeSessionId, renameValue.trim())
      invalidateSessions(workspace.id)
    } catch (err) {
      console.error('Failed to rename session:', err)
    }
    setRenameOpen(false)
  }, [activeSessionId, renameValue, workspace.id, invalidateSessions])

  // Font size
  const [fontSize, setFontSize] = useState(
    () => Number(localStorage.getItem('tos-chat-font-size')) || FONT_SIZE_DEFAULT,
  )
  const changeFontSize = useCallback((delta: number) => {
    setFontSize((prev) => {
      const next = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, prev + delta))
      localStorage.setItem('tos-chat-font-size', String(next))
      return next
    })
  }, [])

  // ── Scroll ──
  const {
    scrollRef,
    showScrollBtn,
    markPendingScroll,
    handleScrollBtnClick,
    setPaused: setAutoScrollPaused,
  } = useAutoScroll([messages], activeSessionId)

  // Search — `panelRef` scopes the cmd+F shortcut to the chat panel root so
  // other panels (files, terminal) in adjacent slots keep browser-native Find.
  const panelRef = useRef<HTMLDivElement>(null)
  const {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchMatches,
    searchIndex,
    searchInputRef,
    navigateSearch,
  } = useChatSearch(scrollRef, panelRef, messages)

  // While the search bar is open it owns the viewport: follow-the-tail would
  // otherwise snap back to the bottom on the next message and fight the jump
  // to the highlighted match.
  useEffect(() => {
    setAutoScrollPaused(searchOpen)
  }, [searchOpen, setAutoScrollPaused])

  // ── Virtualization ──
  // When search is open, fall back to flat rendering so the CSS Highlight API
  // has every text node available for treewalker-based range finding.
  const virtualizeList = !searchOpen && messages.length > 30

  // Virtualize only the history (everything except the tail). The streaming
  // tail re-renders every chunk; keeping it in the virtualizer triggered
  // measureElement → scroll anchoring → 1–2px jitter when partially visible.
  // Rendering it in normal flow below the spacer eliminates that jitter, and
  // costs nothing since the tail is always near the viewport anyway.
  const virtualCount = virtualizeList ? Math.max(0, messages.length - 1) : 0
  const virtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 120,
    overscan: 6,
    getItemKey: (index) => messages[index]?.id ?? index,
  })

  const handleComposerSubmit = (text: string, images: ChatImageAttachment[]) => {
    if (isDeleting) return
    // Mid-turn, a submit promotes the composer text to the session's queued
    // follow-up — the text stays in the box (now marked pending) and cp drains
    // it when the turn ends. Any attached images ride along into the queued
    // payload and the thumbnails are cleared, matching the immediate-send path
    // (the agent rejects an empty message, so an image-only queue carries a
    // single space, just like immediate send).
    const hasImages = images.length > 0
    if (isLoading) {
      actions.updatePendingMessage(text.trim() ? text : ' ', hasImages ? images : undefined)
      setAttachedImages([])
      return
    }
    const raw = text || ' '
    // transformFirstMessage is for a new session's first message only.
    const message = !activeSessionId && transformFirstMessage ? transformFirstMessage(raw) : raw
    actions.sendMessage(message, hasImages ? images : undefined)
    clearDraft()
    setAttachedImages([])
    markPendingScroll()
  }

  const sendCommand = useCallback(
    (text: string) => {
      actions.sendMessage(text)
      markPendingScroll()
    },
    [actions, markPendingScroll],
  )

  // Restore focus and put the caret at the draft's end on session switch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run on session switch
  useEffect(() => {
    composerRef.current?.focus({ caret: 'end' })
  }, [activeSessionId])

  // Let panels outside the chat (e.g. the file browser's "Add to chat" action)
  // splice an `@file/` reference in at the composer's caret. Declared after the
  // restore effect above so that, on a fresh mount, the caret is already at the
  // draft's end before an insert runs.
  useComposerInsertRequests({
    workspaceId: workspace.id,
    enabled: !readonly,
    insert: (text) => composerRef.current?.insertAtCaret(text),
  })

  // When the session goes idle with a queued message still attached (the turn
  // errored / was interrupted / never drained), drop the server-side pending.
  // The text stays in the composer as an ordinary draft for the user to
  // resend or discard.
  useEffect(() => {
    if (!readonly && pendingMessage && !isLoading && !isSwitching && !isDeleting) {
      actions.clearPendingMessage()
    }
  }, [readonly, pendingMessage, isLoading, isSwitching, isDeleting, actions])

  // A send the server refused comes back here: put it in the composer again,
  // unless the user has already started typing something else.
  useEffect(() => {
    if (!returnedDraft) return
    if (!input) setInput(returnedDraft.content)
    if (returnedDraft.images.length > 0) {
      setAttachedImages((current) => (current.length > 0 ? current : returnedDraft.images))
    }
    actions.clearReturnedDraft()
  }, [returnedDraft, input, setInput, actions])

  const turnCount = useMemo(
    () =>
      messages.reduce((n, m) => {
        if (m.role === 'user') return n + 1
        return n + m.blocks.filter((b) => b.type === 'tool').length
      }, 0),
    [messages],
  )

  // Notify external observers (e.g., teamwork) on every messages-list change
  // so they can derive sub-session links from tool calls without owning their
  // own subscription. Stable callback identity isn't required — caller can
  // memoise if they care.
  useEffect(() => {
    onMessages?.(messages)
  }, [messages, onMessages])

  const handleResetSession = async () => {
    await actions.deleteSession()
    invalidateSessions(workspace.id)
    actions.switchSession(undefined)
  }

  return (
    <TranscriptProviders agentType={agentType}>
      {/* The panel chrome (header, dialogs, composer toolbar extras) is app UI
          keyed against the host i18n bundle. TranscriptProviders'
          TranscriptI18nProvider rebinds useTranslation to the SDK's chat-only
          instance, which would make every self-translating app child
          (ShareSessionButton, …) render raw keys.
          Override back to the app instance here; the SDK components that
          render transcript strings (MessageBubble / TurnStatsBar) re-assert
          it, and the Composer and AskUserQuestionPanel bind the SDK instance on
          their own. */}
      <I18nextProvider i18n={appI18n}>
        {!readonly &&
          headerSlot &&
          createPortal(
            <>
              {!sessionsAppOpened && (
                <div className="min-w-0 flex-1">
                  <Select
                    value={activeSessionId ?? '__new__'}
                    onValueChange={(value) => {
                      if (isSessionLocked) return
                      const newSessionId = value === '__new__' ? undefined : value
                      const session = newSessionId
                        ? sessions.find((s) => s.id === newSessionId)
                        : undefined
                      actions.switchSession(
                        newSessionId,
                        session
                          ? {
                              sessionChatStatus: session.chat_status,
                              lastTurnStats: session.last_turn_stats,
                            }
                          : undefined,
                      )
                    }}
                    disabled={isSessionLocked}
                  >
                    <SelectTrigger className="h-7 border-foreground/[0.06] bg-foreground/[0.04] px-2 text-xs shadow-none">
                      <SelectValue placeholder={t('components.sidebar.sessions.newSession')} />
                    </SelectTrigger>
                    <SelectContent>
                      {sessions.map((session) => (
                        <SelectItem key={session.id} value={session.id} className="text-xs">
                          <span className="truncate">{formatSessionLabel(session, t)}</span>
                        </SelectItem>
                      ))}
                      {hasNextPage && <LoadMoreSentinel onVisible={fetchNextPage} />}
                      {!activeSessionId && (
                        <SelectItem value="__new__" className="text-xs">
                          + {t('components.sidebar.sessions.newSession')}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {sessionSource &&
                (sessionSource.url ? (
                  <a
                    href={sessionSource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-info/15 px-2 py-0.5 text-mini font-medium text-info transition-colors hover:bg-info/25"
                  >
                    <span>via {sessionSource.connector_name}</span>
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                ) : (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-info/15 px-2 py-0.5 text-mini font-medium text-info">
                    via {sessionSource.connector_name}
                  </span>
                ))}
              {callerAgent && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-mini font-medium text-primary"
                  title={t('components.workspaceChat.states.invokedBy', {
                    agent: callerAgent.name,
                  })}
                >
                  <Bot className="h-2.5 w-2.5" />
                  {t('components.workspaceChat.states.invokedBy', {
                    agent: callerAgent.name,
                  })}
                </span>
              )}
              {isDeleting && (
                <span className="inline-flex shrink-0 items-center gap-1 text-mini text-muted-foreground">
                  <Spinner size="sm" className="h-3 w-3" />
                  {t('components.workspaceChat.states.resetting')}
                </span>
              )}
              <div className="flex shrink-0 items-center gap-0.5">
                {activeSessionId && (
                  <ShareSessionButton workspaceId={workspace.id} sessionId={activeSessionId} />
                )}
                <AppHeaderButton
                  icon={SquarePen}
                  label={t('components.sidebar.sessions.newSession')}
                  onClick={() => {
                    if (!isSessionLocked) actions.switchSession(undefined)
                  }}
                  disabled={isSessionLocked}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <AppHeaderButton icon={MoreHorizontal} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      className="text-xs"
                      onSelect={() => {
                        const next = !searchOpen
                        setSearchOpen(next)
                        if (next) setTimeout(() => searchInputRef.current?.focus(), 0)
                        else setSearchQuery('')
                      }}
                    >
                      <Search className="h-3.5 w-3.5" />
                      {t('components.workspaceChat.actions.search')}
                    </DropdownMenuItem>
                    {activeSessionId && (
                      <DropdownMenuItem className="text-xs" onSelect={startRename}>
                        <Pencil className="h-3.5 w-3.5" />
                        {t('components.workspaceChat.actions.rename')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-xs"
                      disabled={fontSize <= FONT_SIZE_MIN}
                      onSelect={() => changeFontSize(-FONT_SIZE_STEP)}
                    >
                      <Minus className="h-3.5 w-3.5" />
                      {t('components.workspaceChat.actions.smallerText')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-xs"
                      disabled={fontSize >= FONT_SIZE_MAX}
                      onSelect={() => changeFontSize(FONT_SIZE_STEP)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t('components.workspaceChat.actions.largerText')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-xs text-destructive focus:text-destructive"
                      disabled={isChatBusy}
                      onSelect={handleResetSession}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {isDeleting
                        ? t('components.workspaceChat.states.resetting')
                        : t('components.workspaceChat.actions.resetSession')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </>,
            headerSlot,
          )}

        <div ref={panelRef} className="flex h-full flex-col">
          <div className="relative min-h-0 flex-1">
            {/* Search bar — floats over messages */}
            {searchOpen && (
              <div className="absolute top-2 right-2 left-2 z-10 flex items-center gap-1.5 rounded-lg border border-foreground/[0.08] bg-popover px-3 py-1.5 shadow-lg">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (isCommitEnter(e)) {
                      e.preventDefault()
                      navigateSearch(e.shiftKey ? 'prev' : 'next')
                    }
                    if (e.key === 'Escape') {
                      setSearchOpen(false)
                      setSearchQuery('')
                    }
                  }}
                  placeholder={t('components.workspaceChat.placeholders.searchMessages')}
                  className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
                />
                {searchQuery && (
                  <span className="text-mini tabular-nums text-muted-foreground shrink-0">
                    {searchMatches.length > 0
                      ? `${searchIndex + 1}/${searchMatches.length}`
                      : t('components.workspaceChat.empty.noMatches')}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0"
                  onClick={() => navigateSearch('prev')}
                  disabled={searchMatches.length === 0}
                >
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0"
                  onClick={() => navigateSearch('next')}
                  disabled={searchMatches.length === 0}
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0"
                  onClick={() => {
                    setSearchOpen(false)
                    setSearchQuery('')
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
            <div ref={scrollRef} className="absolute inset-0 overflow-y-auto" style={{ fontSize }}>
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  {isSwitching ? (
                    <Spinner size="sm" />
                  ) : (
                    <EmptyHero
                      illustration={<EmptyIllustration src="sessions" size="h-32" />}
                      title={t('components.workspaceChat.empty.startConversation.title')}
                      description={t(
                        'components.workspaceChat.empty.startConversation.description',
                      )}
                    />
                  )}
                </div>
              ) : virtualizeList ? (
                <div className="px-3 pt-3">
                  <div
                    style={{
                      height: virtualizer.getTotalSize(),
                      width: '100%',
                      position: 'relative',
                    }}
                  >
                    {virtualizer.getVirtualItems().map((vi) => (
                      <div
                        key={vi.key}
                        data-index={vi.index}
                        ref={virtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${vi.start}px)`,
                        }}
                      >
                        <div className="pb-3">
                          <TranscriptI18nProvider locale={i18n.language}>
                            <MessageBubble
                              message={messages[vi.index]}
                              showAuthor={showAuthorOf(messages[vi.index])}
                              expandAll={searchOpen}
                            />
                          </TranscriptI18nProvider>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Tail rendered in normal flow — see virtualCount above. */}
                  {messages.length > 0 && (
                    <div className="pb-3">
                      <TranscriptI18nProvider locale={i18n.language}>
                        <MessageBubble
                          message={messages[messages.length - 1]}
                          showAuthor={showAuthorOf(messages[messages.length - 1])}
                          isLatest
                          expandAll={searchOpen}
                        />
                      </TranscriptI18nProvider>
                    </div>
                  )}
                  {error && (
                    <Alert variant="destructive" className="mb-3 p-3">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                </div>
              ) : (
                <div className="p-3 space-y-3">
                  {messages.map((msg, idx) => (
                    <TranscriptI18nProvider key={msg.id} locale={i18n.language}>
                      <MessageBubble
                        message={msg}
                        showAuthor={showAuthorOf(msg)}
                        isLatest={idx === messages.length - 1}
                        expandAll={searchOpen}
                      />
                    </TranscriptI18nProvider>
                  ))}
                  {error && (
                    <Alert variant="destructive" className="p-3">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </div>
            {showScrollBtn && (
              <button
                type="button"
                onClick={handleScrollBtnClick}
                className="absolute bottom-3 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-foreground/[0.08] bg-popover text-muted-foreground shadow-md transition-colors hover:text-foreground"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            )}
          </div>

          {!isLoading && messages.length > 0 && (
            <TranscriptI18nProvider locale={i18n.language}>
              <TurnStatsBar
                turns={turnCount}
                contextTokens={lastTurnStats?.contextTokens}
                contextWindow={lastTurnStats?.contextWindow}
              />
            </TranscriptI18nProvider>
          )}

          {pendingQuestion && (
            <AskUserQuestionPanel
              request={pendingQuestion}
              onRespond={actions.respondToQuestion}
              locale={i18n.language}
            />
          )}

          {!readonly && <HintBar visible={isLoading} hints={hints} />}
          {!readonly && waitingOnAgents && !isLoading && (
            <WaitingOnAgentsNotice count={pendingAgentCalls} locale={i18n.language} />
          )}
          {!readonly && (
            <Composer
              ref={composerRef}
              className="shrink-0 border-t border-foreground/[0.06] p-3"
              value={input}
              onChange={setInput}
              onSubmit={handleComposerSubmit}
              onRunCommand={sendCommand}
              onStop={actions.stop}
              running={isLoading}
              disabled={isDeleting}
              sendKey={chatSendKeyMode}
              pending={
                pendingMessage
                  ? {
                      dirty: input !== pendingMessage.content,
                      onDiscard: actions.clearPendingMessage,
                    }
                  : null
              }
              attachments={{
                items: attachedImages,
                onAdd: (images) => setAttachedImages((prev) => [...prev, ...images]),
                onRemove: (index) =>
                  setAttachedImages((prev) => prev.filter((_, j) => j !== index)),
              }}
              {...composerSources}
              toolbar={
                compactCommand && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={isChatBusy}
                        onClick={() => sendCommand(compactCommand.content)}
                        aria-label={t('components.workspaceChat.actions.compactConversation')}
                      >
                        <Shrink className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('components.workspaceChat.actions.compactConversation')}
                    </TooltipContent>
                  </Tooltip>
                )
              }
            />
          )}
        </div>
        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{t('components.workspaceChat.dialog.renameTitle')}</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                commitRename()
              }}
            >
              <Input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder={t('components.workspaceChat.placeholders.sessionName')}
              />
              <DialogFooter className="mt-4">
                <Button type="button" variant="ghost" onClick={() => setRenameOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={!renameValue.trim()}>
                  {t('common.save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </I18nextProvider>
    </TranscriptProviders>
  )
}
