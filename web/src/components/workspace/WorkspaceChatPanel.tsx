import { AgentTypeProvider } from '@/components/chat/AgentTypeContext'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { TurnStatsBar } from '@/components/chat/TurnStatsBar'
import { VoiceInputButton, type VoiceInputHandle } from '@/components/chat/VoiceInputButton'
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
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AskUserQuestionPanel } from '@/components/workspace/AskUserQuestionPanel'
import { useAgentMention, useSlashCommands } from '@/components/workspace/CommandTrigger'
import { useFileMention } from '@/components/workspace/FileMention'
import { ShareSessionButton } from '@/components/workspace/ShareSessionButton'
import { useSlotContext } from '@/contexts/SlotContext'
import { useAgentInfo } from '@/hooks/useAgentInfo'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { useChatSearch } from '@/hooks/useChatSearch'
import { shouldSubmitOnKey, useChatSendKey } from '@/hooks/useChatSendKey'
import { useSessionSource } from '@/hooks/useSessionSource'
import { useInvalidateSessions, useSessions } from '@/hooks/useSessions'
import { useMarkSeen } from '@/hooks/useUnread'
import { api } from '@/lib/api/client'
import type { ChatImageAttachment, Session, Workspace } from '@/lib/api/types'
import { isCommitEnter } from '@/lib/keyboard'
import { cleanSessionPreview } from '@/lib/session-utils'
import { cn } from '@/lib/utils'
import { useAgentSessionActions, useAgentSessionStore } from '@/stores/AgentSessionContext'
import type { ChatMessage as ChatMessageType } from '@/stores/agent-session-store'
import { useComposerInsertRequests } from '@/stores/composer-store'
import { useDraft } from '@/stores/draft-store'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Bot,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Hourglass,
  ImagePlus,
  ListPlus,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Send,
  Shrink,
  Square,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

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
  if (diffMin < 60) return t('components.workspaceChat.relativeTime.minutesAgo', { count: diffMin })
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return t('components.workspaceChat.relativeTime.hoursAgo', { count: diffHr })
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay === 1) return t('components.workspaceChat.relativeTime.yesterday')
  if (diffDay < 30) return t('components.workspaceChat.relativeTime.daysAgo', { count: diffDay })
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

function VoiceCapturePanel({ state }: { state: 'recording' | 'transcribing' }) {
  const { t } = useTranslation()
  const label =
    state === 'recording'
      ? t('components.voiceInput.states.listening')
      : t('components.voiceInput.states.transcribing')
  // Staggered offsets give the equalizer an organic, asymmetric pulse.
  const eqDelays = ['-0.4s', '-0.1s', '-0.7s', '-0.25s', '-0.55s']

  return (
    <output
      aria-live="polite"
      className={cn(
        // Overlay fills the Textarea's box exactly so swapping is height-stable.
        'absolute inset-0 flex items-center gap-2.5 px-3 text-xs',
        'bg-gradient-to-br from-primary/[0.18] via-info/[0.12] to-primary/[0.06]',
      )}
    >
      {/* Soft radial highlight in the upper-right — gives the gradient depth without animation. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_-30%,oklch(var(--info)/0.22),transparent_55%)]"
      />
      <div aria-hidden className="relative flex h-4 items-center gap-[3px]">
        {eqDelays.map((delay, i) => (
          <span
            key={i}
            style={{ animationDelay: delay }}
            className="block h-3 w-[2px] origin-center rounded-full bg-primary/80 animate-voice-eq"
          />
        ))}
      </div>
      <span className="relative font-medium tracking-wide text-foreground/85">{label}</span>
    </output>
  )
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
  const { t } = useTranslation()
  const { mode: chatSendKeyMode } = useChatSendKey()
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
      t('components.workspaceChat.hints.compactConversation'),
    ],
    [t, chatSendKeyMode],
  )
  // ── Store ──
  const activeSessionId = useAgentSessionStore((s) => s.activeSessionId)
  const messages = useAgentSessionStore((s) => s.messages)
  const isLoading = useAgentSessionStore((s) => s.isLoading)
  const isSwitching = useAgentSessionStore((s) => s.isSwitching)
  const isDeleting = useAgentSessionStore((s) => s.isDeleting)
  const error = useAgentSessionStore((s) => s.error)
  const pendingQuestion = useAgentSessionStore((s) => s.pendingQuestion)
  const pendingMessage = useAgentSessionStore((s) => s.pendingMessage)
  const lastTurnStats = useAgentSessionStore((s) => s.lastTurnStats)
  const actions = useAgentSessionActions()

  const isChatBusy = isLoading || isDeleting
  const isSessionLocked = isDeleting || isSwitching

  // ── Session list ──
  const { data: sessions = [], fetchNextPage, hasNextPage } = useSessions(workspace.id)
  const invalidateSessions = useInvalidateSessions()
  const markSeen = useMarkSeen()

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
  // Whether the composer text matches what's currently queued on the session.
  // Drives the pending marker and the "queue" button: a submit only has work
  // to do when the composer differs from the queued draft.
  const isQueued = !!pendingMessage && input === pendingMessage.content
  const isQueuedDirty = !!pendingMessage && input !== pendingMessage.content
  const [attachedImages, setAttachedImages] = useState<ChatImageAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const voiceInputRef = useRef<VoiceInputHandle>(null)
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const isVoiceActive = voiceState !== 'idle'
  const { agentInfo } = useAgentInfo(workspace.id)
  const agentType = agentInfo?.agent_type ?? 'claude-code'
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

  const addImageFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1]
        if (base64) {
          setAttachedImages((prev) => [...prev, { data: base64, media_type: file.type }])
        }
      }
      reader.readAsDataURL(file)
    }
  }, [])

  // ── Scroll ──
  const { scrollRef, showScrollBtn, markPendingScroll, handleScrollBtnClick } = useAutoScroll(
    [messages],
    activeSessionId,
  )

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

  const {
    slashVisible,
    menu: slashMenu,
    structDialog: slashStructDialog,
  } = useSlashCommands({
    workspaceId: workspace.id,
    input,
    setInput,
    sendMessage: (msg) => {
      actions.sendMessage(msg)
      markPendingScroll()
    },
    inputRef: inputRef as React.RefObject<HTMLElement | null>,
  })

  const { mentionVisible, mentionMenu } = useAgentMention({
    workspaceId: workspace.id,
    input,
    setInput,
    inputRef: inputRef as React.RefObject<HTMLElement | null>,
  })

  const { fileMentionVisible, fileMentionMenu } = useFileMention({
    workspaceId: workspace.id,
    input,
    setInput,
    inputRef: inputRef as React.RefObject<HTMLElement | null>,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (slashVisible || mentionVisible || fileMentionVisible) return
    if (isDeleting) return
    // Mid-turn, a submit promotes the composer text to the session's queued
    // follow-up — the text stays in the box (now marked pending) and cp drains
    // it when the turn ends. Any attached images ride along into the queued
    // payload and the thumbnails are cleared, matching the immediate-send path
    // (the agent rejects an empty message, so an image-only queue carries a
    // single space, just like immediate send).
    if (isLoading) {
      const hasImages = attachedImages.length > 0
      if (input.trim() || hasImages) {
        const text = input.trim() ? input : hasImages ? ' ' : input
        actions.updatePendingMessage(text, hasImages ? attachedImages : undefined)
        setAttachedImages([])
      }
      return
    }
    if (input.trim() || attachedImages.length > 0) {
      const raw = input || ' '
      // transformFirstMessage is for a new session's first message only.
      const text = !activeSessionId && transformFirstMessage ? transformFirstMessage(raw) : raw
      actions.sendMessage(text, attachedImages.length > 0 ? attachedImages : undefined)
      clearDraft()
      setAttachedImages([])
      if (inputRef.current) inputRef.current.style.height = 'auto'
      markPendingScroll()
    }
  }

  const adjustTextareaHeight = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = window.innerHeight * 0.5
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
  }, [])

  // Restore textarea height and cursor position when draft changes (e.g. session switch)
  useEffect(() => {
    adjustTextareaHeight()
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [activeSessionId, adjustTextareaHeight])

  // Let panels outside the chat (e.g. the file browser's "Add to chat" action)
  // splice an `@file/` reference in at the composer's caret. Declared after the
  // restore effect above so that, on a fresh mount, the caret is already at the
  // draft's end before an insert runs.
  useComposerInsertRequests({
    workspaceId: workspace.id,
    enabled: !readonly,
    inputRef,
    setInput,
    onInserted: adjustTextareaHeight,
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (shouldSubmitOnKey(e, chatSendKeyMode)) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  // Global voice toggle: ⌘/Ctrl + Shift + M from anywhere on the page.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && (e.key === 'M' || e.key === 'm')) {
        e.preventDefault()
        if (voiceState === 'recording') {
          voiceInputRef.current?.stop(false)
        } else if (voiceState === 'idle' && !isChatBusy) {
          voiceInputRef.current?.start()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [voiceState, isChatBusy])

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const imageFiles: File[] = []
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) imageFiles.push(file)
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault()
        addImageFiles(imageFiles)
      }
    },
    [addImageFiles],
  )

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
    <AgentTypeProvider value={agentType}>
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
                        {formatSessionLabel(session, t)}
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
                title={t('components.workspaceChat.states.invokedBy', { agent: callerAgent.name })}
              >
                <Bot className="h-2.5 w-2.5" />
                {t('components.workspaceChat.states.invokedBy', { agent: callerAgent.name })}
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
                    description={t('components.workspaceChat.empty.startConversation.description')}
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
                        <MessageBubble message={messages[vi.index]} />
                      </div>
                    </div>
                  ))}
                </div>
                {/* Tail rendered in normal flow — see virtualCount above. */}
                {messages.length > 0 && (
                  <div className="pb-3">
                    <MessageBubble message={messages[messages.length - 1]} />
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
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
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
          <TurnStatsBar
            turns={turnCount}
            contextTokens={lastTurnStats?.contextTokens}
            contextWindow={lastTurnStats?.contextWindow}
          />
        )}

        {pendingQuestion && (
          <AskUserQuestionPanel request={pendingQuestion} onRespond={actions.respondToQuestion} />
        )}

        {!readonly && <HintBar visible={isLoading} hints={hints} />}
        {!readonly && (
          <form onSubmit={handleSubmit} className="shrink-0 border-t border-foreground/[0.06] p-3">
            {attachedImages.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pb-2">
                {attachedImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={`data:${img.media_type};base64,${img.data}`}
                      alt="attachment"
                      className="h-14 w-14 rounded border border-foreground/[0.08] object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setAttachedImages((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-mini"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="relative">
              {slashMenu}
              {mentionMenu}
              {fileMentionMenu}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addImageFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <div
                className={cn(
                  'relative overflow-hidden rounded-lg border border-foreground/[0.08] bg-background/40 transition-colors',
                  'focus-within:border-foreground/[0.20] focus-within:bg-background',
                  // Writing line: a hairline of primary at the bottom edge — fades in on focus,
                  // and stays steadily lit while the assistant streams (no animation).
                  'after:pointer-events-none after:absolute after:inset-x-3 after:bottom-0 after:h-px after:rounded-full',
                  'after:bg-gradient-to-r after:from-transparent after:via-primary/70 after:to-transparent',
                  'after:opacity-0 after:transition-opacity after:duration-300 focus-within:after:opacity-100',
                  isLoading && 'after:opacity-100',
                  // In-pending: the whole composer surface signals the queued
                  // state — primary tint + solid primary border, held through
                  // focus so it doesn't flicker back to neutral.
                  pendingMessage &&
                    'border-primary/50 bg-primary/[0.06] focus-within:border-primary/60 focus-within:bg-primary/[0.06]',
                )}
              >
                {isLoading && (
                  <div
                    className={cn(
                      // Fixed height so the strip doesn't grow when it swaps
                      // from the plain hint to the taller pending pill + ✕.
                      'flex h-7 items-center gap-1.5 border-b px-3',
                      pendingMessage ? 'border-primary/15' : 'border-foreground/[0.06]',
                    )}
                  >
                    {pendingMessage ? (
                      <>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-1.5 py-0.5 text-mini font-medium text-primary-foreground">
                          <Hourglass className="h-2.5 w-2.5" />
                          {t('components.workspaceChat.pending.label')}
                        </span>
                        <span className="truncate text-mini text-muted-foreground">
                          {isQueuedDirty
                            ? t('components.workspaceChat.pending.unsavedChanges')
                            : t('components.workspaceChat.pending.autoSendHint')}
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="ml-auto h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                              onClick={actions.clearPendingMessage}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t('components.workspaceChat.pending.clear')}
                          </TooltipContent>
                        </Tooltip>
                      </>
                    ) : (
                      <>
                        <Hourglass className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate text-mini text-muted-foreground">
                          {t('components.workspaceChat.pending.composerHint')}
                        </span>
                      </>
                    )}
                  </div>
                )}
                <div className="relative">
                  <Textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value)
                      adjustTextareaHeight()
                    }}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    readOnly={isVoiceActive}
                    placeholder={
                      chatSendKeyMode === 'enter'
                        ? t('components.workspaceChat.placeholders.messageInputEnter')
                        : t('components.workspaceChat.placeholders.messageInput', {
                            modifier: navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl',
                          })
                    }
                    className={cn(
                      'resize-none text-xs min-h-0 border-0 bg-transparent px-3 pt-2 pb-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 overflow-y-auto max-h-[50vh] caret-primary',
                      isVoiceActive && 'invisible pointer-events-none',
                    )}
                    rows={1}
                  />
                  {isVoiceActive && <VoiceCapturePanel state={voiceState} />}
                </div>
                <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-0">
                  <div className="flex items-center gap-1">
                    {!isLoading && (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={isChatBusy}
                              onClick={() => fileInputRef.current?.click()}
                            >
                              <ImagePlus className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t('components.workspaceChat.actions.attachImage')}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={isChatBusy}
                              onClick={() => {
                                actions.sendMessage('/compact')
                                markPendingScroll()
                              }}
                            >
                              <Shrink className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t('components.workspaceChat.actions.compactConversation')}
                          </TooltipContent>
                        </Tooltip>
                        <VoiceInputButton
                          ref={voiceInputRef}
                          disabled={isChatBusy}
                          onStateChange={setVoiceState}
                          onTranscribed={(text) => {
                            setInput(input ? `${input} ${text}` : text)
                            requestAnimationFrame(() => {
                              inputRef.current?.focus()
                              adjustTextareaHeight()
                            })
                          }}
                        />
                      </>
                    )}
                  </div>
                  {isLoading ? (
                    <span
                      key="stop"
                      className="inline-flex items-center gap-1 animate-in fade-in zoom-in-90 duration-200"
                    >
                      {input.trim() && !isQueued && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button type="submit" size="sm" className="h-7 px-3">
                              <ListPlus className="h-3.5 w-3.5" />
                              {t('components.workspaceChat.actions.queue')}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t('components.workspaceChat.pending.queueHint')}
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={actions.stop}
                          >
                            <Square className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('components.workspaceChat.actions.stop')}
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  ) : (
                    <span
                      key="send"
                      className="inline-flex animate-in fade-in zoom-in-90 duration-200"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="submit"
                            size="sm"
                            className="h-7 px-3"
                            disabled={!input.trim() || isChatBusy}
                          >
                            <Send className="h-3.5 w-3.5" />
                            {t('components.workspaceChat.actions.send')}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t(
                            chatSendKeyMode === 'enter'
                              ? 'components.workspaceChat.actions.sendShortcutEnter'
                              : 'components.workspaceChat.actions.sendShortcut',
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </form>
        )}
        {slashStructDialog}
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
    </AgentTypeProvider>
  )
}
