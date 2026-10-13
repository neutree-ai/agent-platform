import { Hourglass, ImagePlus, ListPlus, Send, Square, X } from 'lucide-react'
import {
  type ClipboardEvent,
  type KeyboardEvent,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSdkLocale, useSdkTranslation } from '../i18n'
import { cn } from '../lib/utils'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { CommandDialog } from './CommandDialog'
import { TriggerMenu, type TriggerMenuRow, triggerOptionId } from './TriggerMenu'
import { VoiceCapturePanel, VoiceControl, useVoiceRecorder } from './Voice'
import { isComposingKey, isTouchFirst, modifierLabel, shouldSubmitOnKey } from './keys'
import {
  type TriggerMatch,
  getSlashQuery,
  insertWithPadding,
  matchTrigger,
  replaceRange,
} from './text'
import type {
  ComposerCommand,
  ComposerHandle,
  ComposerImageAttachment,
  ComposerProps,
  ComposerTrigger,
  ComposerTriggerItem,
} from './types'

const MAX_HEIGHT_RATIO = 0.5

/** Read picked or pasted files as base64 image attachments (non-images are skipped). */
function readImageFiles(files: File[]): Promise<ComposerImageAttachment[]> {
  const reads = files
    .filter((file) => file.type.startsWith('image/'))
    .map(
      (file) =>
        new Promise<ComposerImageAttachment | null>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => {
            const data = String(reader.result ?? '').split(',')[1]
            resolve(data ? { data, media_type: file.type } : null)
          }
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(file)
        }),
    )
  return Promise.all(reads).then((items) =>
    items.filter((i): i is ComposerImageAttachment => i !== null),
  )
}

interface TriggerHit {
  trigger: ComposerTrigger
  match: TriggerMatch
}

/** The trigger whose fragment starts closest to the caret, if any. */
function findTriggerHit(
  triggers: ComposerTrigger[] | undefined,
  value: string,
  caret: number,
): TriggerHit | null {
  let best: TriggerHit | null = null
  for (const trigger of triggers ?? []) {
    const match = matchTrigger(trigger.pattern, value, caret)
    if (match && (!best || match.start > best.match.start)) best = { trigger, match }
  }
  return best
}

interface TriggerResults {
  triggerId: string
  query: string
  items: ComposerTriggerItem[]
}

/**
 * Chat message composer: autosizing textarea with send-key handling, a `/`
 * command menu, caret-anchored trigger menus (`@…`), image attachments, voice
 * input and a queued-follow-up state. Controlled (`value` / `onChange`) and
 * network-free — data sources come in through props.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(props, ref) {
  const {
    value,
    onChange,
    onSubmit,
    onStop,
    running = false,
    disabled = false,
    readOnly = false,
    allowQueue = true,
    pending,
    sendKey = 'mod-enter',
    placeholder,
    attachments,
    voice,
    commands,
    loadCommands,
    triggers,
    toolbar,
    header,
    locale,
    className,
    textareaClassName,
  } = props
  useSdkLocale(locale)
  const { t } = useSdkTranslation()
  const listboxId = `composer-${useId().replace(/:/g, '')}-menu`

  const latest = useRef(props)
  latest.current = props

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composingRef = useRef(false)
  const pendingCaretRef = useRef<number | null>(null)
  const [touch] = useState(isTouchFirst)
  const [caretState, setCaret] = useState(value.length)
  const caret = Math.min(caretState, value.length)

  // ── Voice ──
  const appendTranscript = useCallback((text: string) => {
    const current = latest.current.value
    latest.current.onChange(current ? `${current} ${text}` : text)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])
  const {
    state: voiceState,
    seconds: voiceSeconds,
    start: startVoice,
    stop: stopVoice,
  } = useVoiceRecorder({ voice, onText: appendTranscript })
  const voiceActive = voiceState !== 'idle'

  // Global toggle: ⌘/Ctrl+Shift+M from anywhere on the page (opt-in).
  const voiceShortcut = !!voice?.shortcut && !readOnly
  useEffect(() => {
    if (!voiceShortcut) return
    const handler = (e: globalThis.KeyboardEvent) => {
      if (!e.shiftKey || !(e.metaKey || e.ctrlKey)) return
      if (e.key !== 'M' && e.key !== 'm') return
      e.preventDefault()
      if (voiceState === 'recording') stopVoice(false)
      else if (voiceState === 'idle' && !running && !disabled) void startVoice()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [voiceShortcut, voiceState, running, disabled, startVoice, stopVoice])

  // ── Autosize + programmatic caret placement ──
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * MAX_HEIGHT_RATIO)}px`
    const pos = pendingCaretRef.current
    if (pos !== null) {
      pendingCaretRef.current = null
      el.focus()
      el.setSelectionRange(pos, pos)
    }
  }, [value])

  // ── Menus ──
  // Slash: dismissal lasts while the input stays a `/…` line. Triggers:
  // dismissal lasts until the text changes.
  const menusEnabled = !readOnly && !voiceActive
  const hasCommands = (commands?.length ?? 0) > 0 || !!loadCommands
  const slashQuery = hasCommands ? getSlashQuery(value) : null
  const [slashDismissed, setSlashDismissed] = useState(false)
  useEffect(() => {
    if (slashQuery === null) setSlashDismissed(false)
  }, [slashQuery])
  const slashOpen = menusEnabled && slashQuery !== null && !slashDismissed

  const [loadedCommands, setLoadedCommands] = useState<ComposerCommand[]>([])
  useEffect(() => {
    if (!slashOpen) return
    const load = latest.current.loadCommands
    if (!load) return
    let cancelled = false
    load().then(
      (items) => {
        if (!cancelled) setLoadedCommands(items)
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [slashOpen])

  const slashItems = useMemo(() => {
    if (!slashOpen || slashQuery === null) return []
    return [...(commands ?? []), ...loadedCommands].filter((c) =>
      c.name.toLowerCase().includes(slashQuery),
    )
  }, [slashOpen, slashQuery, commands, loadedCommands])
  const slashActive = slashItems.length > 0

  const [dismissedValue, setDismissedValue] = useState<string | null>(null)
  const hit =
    menusEnabled && !slashActive && dismissedValue !== value
      ? findTriggerHit(triggers, value, caret)
      : null
  const hitId = hit?.trigger.id ?? null
  const hitQuery = hit?.match.query ?? null

  const [results, setResults] = useState<TriggerResults | null>(null)
  useEffect(() => {
    if (hitId === null || hitQuery === null) {
      setResults(null)
      return
    }
    const trigger = latest.current.triggers?.find((tr) => tr.id === hitId)
    if (!trigger) return
    const controller = new AbortController()
    const apply = (items: ComposerTriggerItem[]) => {
      if (!controller.signal.aborted) setResults({ triggerId: hitId, query: hitQuery, items })
    }
    const run = () => {
      try {
        const out = trigger.getItems(hitQuery, controller.signal)
        if (Array.isArray(out)) apply(out)
        else out.then(apply, () => apply([]))
      } catch {
        apply([])
      }
    }
    const delay = hitQuery ? (trigger.debounceMs ?? 0) : 0
    let timer: ReturnType<typeof setTimeout> | undefined
    if (delay > 0) timer = setTimeout(run, delay)
    else run()
    return () => {
      if (timer) clearTimeout(timer)
      controller.abort()
    }
  }, [hitId, hitQuery])

  // Results for an older query stay visible (narrowed, if the trigger can)
  // until the current query's results arrive.
  let triggerItems: ComposerTriggerItem[] = []
  if (hit && results && results.triggerId === hit.trigger.id) {
    triggerItems =
      results.query === hit.match.query || !hit.trigger.narrow
        ? results.items
        : hit.trigger.narrow(results.items, hit.match.query)
  }

  const menuKind: 'slash' | 'trigger' | null = slashActive
    ? 'slash'
    : hit && triggerItems.length > 0
      ? 'trigger'
      : null
  const menuCount = menuKind === 'slash' ? slashItems.length : triggerItems.length
  const menuKey =
    menuKind === 'slash' ? `slash:${slashQuery}` : menuKind ? `${hitId}:${hitQuery}` : ''

  const [activeIndexState, setActiveIndex] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on menu/query change
  useEffect(() => {
    setActiveIndex(0)
  }, [menuKey])
  const activeIndex = Math.max(0, Math.min(activeIndexState, menuCount - 1))

  const [structCommand, setStructCommand] = useState<ComposerCommand | null>(null)

  const runCommand = useCallback((text: string, command: ComposerCommand) => {
    const { onRunCommand, onSubmit } = latest.current
    if (onRunCommand) onRunCommand(text, command)
    else onSubmit(text, [])
  }, [])

  const pick = (index: number) => {
    if (menuKind === 'slash') {
      const command = slashItems[index]
      if (!command) return
      onChange('')
      if (command.type === 'struct') setStructCommand(command)
      else runCommand(command.content, command)
      return
    }
    if (menuKind === 'trigger' && hit) {
      const item = triggerItems[index]
      if (!item) return
      // Re-anchor on the live caret in case it moved since the last render.
      const live = textareaRef.current?.selectionStart ?? caret
      const match = matchTrigger(hit.trigger.pattern, value, live) ?? hit.match
      const next = replaceRange(value, match.start, match.end, item.insertText)
      pendingCaretRef.current = next.caret
      setCaret(next.caret)
      setDismissedValue(item.keepOpen ? null : next.value)
      onChange(next.value)
    }
  }

  const dismissMenu = () => {
    if (menuKind === 'slash') setSlashDismissed(true)
    else setDismissedValue(value)
  }

  // ── Submit ──
  const attachmentItems = attachments?.items ?? []
  const hasContent = value.trim() !== '' || attachmentItems.length > 0

  const submit = () => {
    if (readOnly || disabled || menuKind !== null) return
    if (!hasContent) return
    if (running && !allowQueue) return
    onSubmit(value, attachmentItems)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Composition keys (e.g. Enter confirming an IME candidate) never reach
    // the menu or submit.
    if (composingRef.current || isComposingKey(e)) return
    if (menuKind !== null) {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex(activeIndex <= 0 ? menuCount - 1 : activeIndex - 1)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex(activeIndex >= menuCount - 1 ? 0 : activeIndex + 1)
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        pick(activeIndex)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        dismissMenu()
        return
      }
      if (e.key === 'Enter') {
        // Cmd/Ctrl+Enter while a menu is open neither picks nor sends.
        e.preventDefault()
        return
      }
    }
    if (shouldSubmitOnKey(e, sendKey, { touch })) {
      e.preventDefault()
      submit()
    }
  }

  const addFiles = (files: File[]) => {
    void readImageFiles(files).then((items) => {
      if (items.length > 0) latest.current.attachments?.onAdd(items)
    })
  }

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!attachments || readOnly) return
    const files: File[] = []
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (!item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (file) files.push(file)
    }
    if (files.length > 0) {
      e.preventDefault()
      addFiles(files)
    }
  }

  // ── Imperative handle ──
  useImperativeHandle(
    ref,
    () => ({
      focus: (options) => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        if (options?.caret === 'end') {
          const end = el.value.length
          el.setSelectionRange(end, end)
          setCaret(end)
        }
      },
      insertAtCaret: (text) => {
        const el = textareaRef.current
        const current = el?.value ?? latest.current.value
        const start = el?.selectionStart ?? current.length
        const end = el?.selectionEnd ?? start
        const next = insertWithPadding(current, start, end, text)
        latest.current.onChange(next.value)
        setCaret(next.caret)
        // Deferred to a macrotask so it lands after any closing menu or
        // dialog elsewhere on the page restores focus to its own trigger.
        setTimeout(() => {
          if (!el) return
          el.focus()
          el.setSelectionRange(next.caret, next.caret)
        }, 0)
      },
      get textarea() {
        return textareaRef.current
      },
    }),
    [],
  )

  // ── Render ──
  const isQueuedClean = !!pending && !pending.dirty
  const showBusyStrip = running && allowQueue && !readOnly
  const defaultPlaceholder = touch
    ? t('components.composer.placeholders.touch')
    : sendKey === 'enter'
      ? t('components.composer.placeholders.enter')
      : t('components.composer.placeholders.modEnter', { modifier: modifierLabel() })

  let menuRows: TriggerMenuRow[] = []
  if (menuKind === 'slash') {
    menuRows = slashItems.map((command, i) => {
      const Icon = command.icon
      return {
        key: `${i}:${command.name}`,
        label: (
          <span className="flex items-center gap-1 font-medium">
            {Icon && <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />}/{command.name}
          </span>
        ),
        description: command.description ?? command.content,
        meta: t(`components.composer.commands.types.${command.type}`),
      }
    })
  } else if (menuKind === 'trigger') {
    menuRows = triggerItems
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className={className}
    >
      {header}
      {attachmentItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-2">
          {attachmentItems.map((img, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: attachments carry no id and are removed by index
            <div key={i} className="group relative">
              <img
                src={`data:${img.media_type};base64,${img.data}`}
                alt={t('components.composer.attachmentAlt')}
                className="h-14 w-14 rounded border border-foreground/[0.08] object-cover"
              />
              {!readOnly && (
                <button
                  type="button"
                  aria-label={t('components.composer.actions.removeAttachment')}
                  onClick={() => attachments?.onRemove(i)}
                  className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-destructive text-mini text-destructive-foreground group-hover:flex group-focus-within:flex [@media(hover:none)]:flex"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="relative">
        {menuKind !== null && (
          <TriggerMenu
            id={listboxId}
            label={t('components.composer.menu.label')}
            rows={menuRows}
            activeIndex={activeIndex}
            header={menuKind === 'trigger' && hit ? hit.trigger.header?.(hit.match.query) : null}
            onActiveIndexChange={setActiveIndex}
            onPick={pick}
          />
        )}
        {attachments && (
          <input
            ref={fileInputRef}
            type="file"
            accept={attachments.accept ?? 'image/*'}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(Array.from(e.target.files))
              e.target.value = ''
            }}
          />
        )}
        <div
          className={cn(
            'relative overflow-hidden rounded-lg border border-foreground/[0.08] bg-background/40 transition-colors',
            'focus-within:border-foreground/[0.20] focus-within:bg-background',
            // Writing line: a hairline of primary at the bottom edge — fades in
            // on focus and stays lit while the agent is running.
            'after:pointer-events-none after:absolute after:inset-x-3 after:bottom-0 after:h-px after:rounded-full',
            'after:bg-gradient-to-r after:from-transparent after:via-primary/70 after:to-transparent',
            'after:opacity-0 after:transition-opacity after:duration-300 focus-within:after:opacity-100',
            running && 'after:opacity-100',
            // Queued: the whole surface carries a primary tint, held through
            // focus so it doesn't flicker back to neutral.
            pending &&
              'border-primary/50 bg-primary/[0.06] focus-within:border-primary/60 focus-within:bg-primary/[0.06]',
          )}
        >
          {showBusyStrip && (
            <div
              className={cn(
                // Fixed height so the strip doesn't grow when it swaps from
                // the plain hint to the taller pending pill + discard button.
                'flex h-7 items-center gap-1.5 border-b px-3',
                pending ? 'border-primary/15' : 'border-foreground/[0.06]',
              )}
            >
              {pending ? (
                <>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-1.5 py-0.5 text-mini font-medium text-primary-foreground">
                    <Hourglass className="h-2.5 w-2.5" />
                    {t('components.composer.pending.label')}
                  </span>
                  <span className="truncate text-mini text-muted-foreground">
                    {pending.dirty
                      ? t('components.composer.pending.unsavedChanges')
                      : t('components.composer.pending.autoSendHint')}
                  </span>
                  {pending.onDiscard && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="ml-auto h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={pending.onDiscard}
                          aria-label={t('components.composer.pending.discard')}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('components.composer.pending.discard')}</TooltipContent>
                    </Tooltip>
                  )}
                </>
              ) : (
                <>
                  <Hourglass className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate text-mini text-muted-foreground">
                    {t('components.composer.pending.busyHint')}
                  </span>
                </>
              )}
            </div>
          )}
          <div className="relative">
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                setDismissedValue(null)
                setCaret(e.target.selectionStart ?? e.target.value.length)
                onChange(e.target.value)
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onCompositionStart={() => {
                composingRef.current = true
              }}
              onCompositionEnd={() => {
                composingRef.current = false
              }}
              readOnly={readOnly || voiceActive}
              placeholder={placeholder ?? defaultPlaceholder}
              aria-autocomplete="list"
              aria-controls={menuKind !== null ? listboxId : undefined}
              aria-activedescendant={
                menuKind !== null ? triggerOptionId(listboxId, activeIndex) : undefined
              }
              className={cn(
                'min-h-0 resize-none overflow-y-auto border-0 bg-transparent px-3 pb-1 pt-2 text-xs caret-primary shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 max-h-[50vh]',
                voiceActive && 'pointer-events-none invisible',
                textareaClassName,
              )}
              rows={1}
            />
            {voiceActive && <VoiceCapturePanel state={voiceState} />}
          </div>
          {!readOnly && (
            <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-0">
              <div className="flex items-center gap-1">
                {!running && (
                  <>
                    {attachments && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={disabled}
                            onClick={() => fileInputRef.current?.click()}
                            aria-label={t('components.composer.actions.attachImage')}
                          >
                            <ImagePlus className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('components.composer.actions.attachImage')}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {toolbar}
                  </>
                )}
                {/* A recording in flight keeps its controls even once the
                    agent starts running, so it can still be stopped. */}
                {voice && (!running || voiceActive) && (
                  <VoiceControl
                    state={voiceState}
                    seconds={voiceSeconds}
                    disabled={disabled}
                    shortcut={voiceShortcut}
                    onStart={() => void startVoice()}
                    onStop={stopVoice}
                  />
                )}
              </div>
              {running ? (
                <span
                  key="stop"
                  className="inline-flex items-center gap-1 duration-200 animate-in fade-in zoom-in-90"
                >
                  {allowQueue && value.trim() && !isQueuedClean && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="submit" size="sm" className="h-7 px-3">
                          <ListPlus className="h-3.5 w-3.5" />
                          {t('components.composer.actions.queue')}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('components.composer.pending.queueHint')}</TooltipContent>
                    </Tooltip>
                  )}
                  {onStop && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={onStop}
                          aria-label={t('components.composer.actions.stop')}
                        >
                          <Square className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('components.composer.actions.stop')}</TooltipContent>
                    </Tooltip>
                  )}
                </span>
              ) : (
                <span key="send" className="inline-flex duration-200 animate-in fade-in zoom-in-90">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="submit"
                        size="sm"
                        className="h-7 px-3"
                        disabled={!hasContent || disabled}
                      >
                        <Send className="h-3.5 w-3.5" />
                        {t('components.composer.actions.send')}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {sendKey === 'enter' && !touch
                        ? t('components.composer.actions.sendShortcutEnter')
                        : t('components.composer.actions.sendShortcutModEnter', {
                            modifier: modifierLabel(),
                          })}
                    </TooltipContent>
                  </Tooltip>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {structCommand && (
        <CommandDialog
          command={structCommand}
          onOpenChange={(open) => {
            if (!open) setStructCommand(null)
          }}
          onSend={(text) => runCommand(text, structCommand)}
        />
      )}
    </form>
  )
})
