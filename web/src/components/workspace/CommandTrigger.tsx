import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import createSkillPrompt from '@/docs/create-skill-prompt.md?raw'
import { useCommands } from '@/hooks/useCommands'
import { api } from '@/lib/api/client'
import type { CallableAgent, WorkspaceCommand } from '@/lib/api/types'
import { isCommitEnter } from '@/lib/keyboard'
import { useQuery } from '@tanstack/react-query'
import { Bot, Folder, Library } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

function parseVariables(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g)
  return [...new Set([...matches].map((m) => m[1]))]
}

function resolveTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '')
}

function getEffectiveContent(cmd: WorkspaceCommand): string {
  return cmd.prompt_content || cmd.content
}

// ─── Variable Form Dialog ───────────────────────────────────────────

function StructCommandDialog({
  command,
  open,
  onOpenChange,
  onSend,
}: {
  command: WorkspaceCommand
  open: boolean
  onOpenChange: (v: boolean) => void
  onSend: (message: string) => void
}) {
  const { t } = useTranslation()
  const content = getEffectiveContent(command)
  const variables = parseVariables(content)
  const [values, setValues] = useState<Record<string, string>>({})

  const allFilled = variables.every((v) => values[v]?.trim())

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{command.name}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSend(resolveTemplate(content, values))
            onOpenChange(false)
            setValues({})
          }}
          className="space-y-3"
        >
          {variables.map((v) => (
            <div key={v} className="space-y-1">
              <Label htmlFor={`var_${v}`} className="text-xs">
                {v}
              </Label>
              <Input
                id={`var_${v}`}
                value={values[v] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [v]: e.target.value }))}
                placeholder=""
                className="h-8 text-xs"
              />
            </div>
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!allFilled}>
              {t('components.commandTrigger.actions.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Built-in commands ──────────────────────────────────────────────

const BUILTIN_COMMANDS: WorkspaceCommand[] = [
  {
    id: '__builtin_compact__',
    workspace_id: '',
    user_id: '',
    name: 'compact',
    type: 'plain',
    prompt_id: null,
    prompt_content: null,
    content: '/compact',
    sort_order: -1,
    source: 'local',
    disabled: false,
    created_at: '',
    updated_at: '',
  },
  {
    id: '__builtin_create_skill__',
    workspace_id: '',
    user_id: '',
    name: 'create-skill',
    type: 'struct',
    prompt_id: null,
    prompt_content: null,
    content: createSkillPrompt,
    sort_order: -1,
    source: 'local',
    disabled: false,
    created_at: '',
    updated_at: '',
  },
  {
    id: '__builtin_goal__',
    workspace_id: '',
    user_id: '',
    name: 'goal',
    type: 'struct',
    prompt_id: null,
    prompt_content: null,
    content: '/goal {{condition}}',
    sort_order: -1,
    source: 'local',
    disabled: false,
    created_at: '',
    updated_at: '',
  },
]

export const RESERVED_COMMAND_NAMES = new Set(BUILTIN_COMMANDS.map((c) => c.name))

// ─── Slash Command Menu ─────────────────────────────────────────────

function SlashCommandMenu({
  workspaceId,
  input,
  onSelect,
  onDismiss,
  visible,
  anchorRef,
  onActiveChange,
}: {
  workspaceId: string
  input: string
  onSelect: (cmd: WorkspaceCommand) => void
  onDismiss: () => void
  visible: boolean
  anchorRef: React.RefObject<HTMLElement | null>
  onActiveChange: (active: boolean) => void
}) {
  const { t } = useTranslation()
  const [highlightIndex, setHighlightIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)

  const { data: commands } = useCommands(workspaceId, visible)

  // Filter by slash query (e.g. "/rel" filters to commands containing "rel")
  const query = input.startsWith('/') ? input.slice(1).toLowerCase() : ''
  // Disabled template commands stay in the management UI but must not be
  // invokable from the slash menu.
  const allCommands = [...BUILTIN_COMMANDS, ...(commands ?? []).filter((c) => !c.disabled)]
  const filtered = allCommands.filter((cmd) => cmd.name.toLowerCase().includes(query))

  // Reset highlight when filter changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on filter change
  useEffect(() => {
    setHighlightIndex(0)
  }, [query])

  const active = visible && filtered.length > 0
  useEffect(() => {
    onActiveChange(active)
  }, [active, onActiveChange])

  if (!active) return null

  return (
    <>
      <div
        ref={menuRef}
        className="absolute bottom-full left-0 right-0 mb-1 rounded-md border border-border bg-popover shadow-md z-50 overflow-hidden"
      >
        <div className="max-h-48 overflow-y-auto p-1">
          {filtered.map((cmd, i) => (
            <button
              type="button"
              key={cmd.id}
              className={`flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left ${
                i === highlightIndex ? 'bg-accent' : 'hover:bg-accent'
              }`}
              onMouseEnter={() => setHighlightIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(cmd)
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-xs font-medium truncate">
                  {cmd.prompt_id && <Library className="h-3 w-3 shrink-0 text-muted-foreground" />}/
                  {cmd.name}
                </div>
                <div className="text-tiny text-muted-foreground truncate">
                  {getEffectiveContent(cmd)}
                </div>
              </div>
              <span className="mt-0.5 text-mini text-muted-foreground shrink-0">
                {t(`components.commandTrigger.types.${cmd.type}`)}
              </span>
            </button>
          ))}
        </div>
      </div>
      <SlashCommandKeyHandler
        highlightIndex={highlightIndex}
        setHighlightIndex={setHighlightIndex}
        filtered={filtered}
        onSelect={onSelect}
        onDismiss={onDismiss}
        anchorRef={anchorRef}
      />
    </>
  )
}

// Keyboard navigation — attaches to the textarea via event listener
function SlashCommandKeyHandler({
  highlightIndex,
  setHighlightIndex,
  filtered,
  onSelect,
  onDismiss,
  anchorRef,
}: {
  highlightIndex: number
  setHighlightIndex: (i: number) => void
  filtered: WorkspaceCommand[]
  onSelect: (cmd: WorkspaceCommand) => void
  onDismiss: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}) {
  useEffect(() => {
    const el = anchorRef.current
    if (!el) return

    const handler = (e: Event) => {
      const ke = e as KeyboardEvent
      if (ke.key === 'ArrowUp') {
        ke.preventDefault()
        setHighlightIndex(highlightIndex <= 0 ? filtered.length - 1 : highlightIndex - 1)
      } else if (ke.key === 'ArrowDown') {
        ke.preventDefault()
        setHighlightIndex(highlightIndex >= filtered.length - 1 ? 0 : highlightIndex + 1)
      } else if (isCommitEnter(ke) && !ke.ctrlKey && !ke.metaKey) {
        ke.preventDefault()
        if (filtered[highlightIndex]) onSelect(filtered[highlightIndex])
      } else if (ke.key === 'Escape') {
        ke.preventDefault()
        onDismiss()
      }
    }

    el.addEventListener('keydown', handler, true)
    return () => el.removeEventListener('keydown', handler, true)
  }, [highlightIndex, filtered, onSelect, onDismiss, setHighlightIndex, anchorRef])

  return null
}

// ─── Hook: slash command integration ────────────────────────────────

export function useSlashCommands({
  workspaceId,
  input,
  setInput,
  sendMessage,
  inputRef,
}: {
  workspaceId: string
  input: string
  setInput: (v: string) => void
  sendMessage: (msg: string) => void
  inputRef: React.RefObject<HTMLElement | null>
}) {
  const [slashVisible, setSlashVisible] = useState(false)
  const [slashActive, setSlashActive] = useState(false)
  const [structCommand, setStructCommand] = useState<WorkspaceCommand | null>(null)

  // Show menu when input starts with /
  const isSlash = input.startsWith('/') && !input.includes('\n')
  useEffect(() => {
    setSlashVisible(isSlash)
  }, [isSlash])

  const handleSelect = (cmd: WorkspaceCommand) => {
    setSlashVisible(false)
    setInput('')
    const content = getEffectiveContent(cmd)
    if (cmd.type === 'struct') {
      setStructCommand(cmd)
    } else {
      sendMessage(content)
    }
  }

  const handleDismiss = () => {
    setSlashVisible(false)
  }

  const menu = (
    <SlashCommandMenu
      workspaceId={workspaceId}
      input={input}
      onSelect={handleSelect}
      onDismiss={handleDismiss}
      visible={slashVisible}
      anchorRef={inputRef}
      onActiveChange={setSlashActive}
    />
  )

  const structDialog = structCommand ? (
    <StructCommandDialog
      command={structCommand}
      open={!!structCommand}
      onOpenChange={(v) => !v && setStructCommand(null)}
      onSend={sendMessage}
    />
  ) : null

  return { slashVisible: slashActive, menu, structDialog }
}

// ─── @ Agent Mention ─────────────────────────────────────────────

const AGENT_MENTION_PREFIX = '@agent/'
const FILE_MENTION_PREFIX = '@file/'

type AgentMenuItem = { kind: 'file' } | { kind: 'agent'; agent: CallableAgent }

/** Extract @mention fragment at cursor position. Matches both @query and @agent/query. */
function getAtMention(
  input: string,
  cursorPos: number,
): { query: string; start: number; end: number } | null {
  const before = input.slice(0, cursorPos)
  // Match @agent/... (partially typed or complete) or bare @...
  // Exclude @file/... — handled by useFileMention.
  const match = before.match(/@(?!file\/)(?:agent\/)?([a-z0-9/-]*)$/)
  if (!match) return null
  const start = before.length - match[0].length
  const end = cursorPos
  return { query: match[1], start, end }
}

/** Get the full addressable slug for a callable agent. */
function agentRef(agent: CallableAgent): string {
  return agent.is_own ? agent.slug : `${agent.owner}/${agent.slug}`
}

function AgentMentionMenu({
  workspaceId,
  input,
  cursorPos,
  onSelect,
  onDismiss,
  visible,
  anchorRef,
  onActiveChange,
}: {
  workspaceId: string
  input: string
  cursorPos: number
  onSelect: (item: AgentMenuItem) => void
  onDismiss: () => void
  visible: boolean
  anchorRef: React.RefObject<HTMLElement | null>
  onActiveChange: (active: boolean) => void
}) {
  const { t } = useTranslation()
  const [highlightIndex, setHighlightIndex] = useState(0)

  const { data: agents } = useQuery({
    queryKey: ['callable-agents'],
    queryFn: () => api.getCallableAgents(),
    enabled: visible,
  })

  const mention = visible ? getAtMention(input, cursorPos) : null
  const query = mention?.query ?? ''

  // Filter: not self, ref matches query
  const filteredAgents = (agents ?? []).filter(
    (a) => a.id !== workspaceId && agentRef(a).includes(query),
  )

  // File entry shows when query matches the literal "file/" prefix.
  const showFileEntry = 'file/'.startsWith(query) || query.length === 0
  const items: AgentMenuItem[] = [
    ...(showFileEntry ? [{ kind: 'file' as const }] : []),
    ...filteredAgents.map((a) => ({ kind: 'agent' as const, agent: a })),
  ]

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on filter change
  useEffect(() => {
    setHighlightIndex(0)
  }, [query])

  const active = visible && !!mention && items.length > 0
  useEffect(() => {
    onActiveChange(active)
  }, [active, onActiveChange])

  if (!active) return null

  return (
    <>
      <div className="absolute bottom-full left-0 right-0 mb-1 rounded-md border border-border bg-popover shadow-md z-50 overflow-hidden">
        <div className="max-h-48 overflow-y-auto p-1">
          {items.map((item, i) => {
            const highlighted = i === highlightIndex
            const cls = `flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left ${
              highlighted ? 'bg-accent' : 'hover:bg-accent'
            }`
            if (item.kind === 'file') {
              return (
                <button
                  type="button"
                  key="__file__"
                  className={cls}
                  onMouseEnter={() => setHighlightIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onSelect(item)
                  }}
                >
                  <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="text-xs font-medium font-mono">{FILE_MENTION_PREFIX}</span>
                  <span className="text-tiny text-muted-foreground truncate">
                    {t('components.commandTrigger.fileMentionHint')}
                  </span>
                </button>
              )
            }
            const agent = item.agent
            return (
              <button
                type="button"
                key={agent.id}
                className={cls}
                onMouseEnter={() => setHighlightIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onSelect(item)
                }}
              >
                <Bot className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="text-xs font-medium font-mono">
                  {AGENT_MENTION_PREFIX}
                  {agentRef(agent)}
                </span>
                <span className="text-tiny text-muted-foreground truncate">{agent.name}</span>
                {!agent.is_own && (
                  <span className="ml-auto text-mini text-muted-foreground shrink-0">
                    {agent.owner}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
      <AgentMentionKeyHandler
        highlightIndex={highlightIndex}
        setHighlightIndex={setHighlightIndex}
        items={items}
        onSelect={onSelect}
        onDismiss={onDismiss}
        anchorRef={anchorRef}
      />
    </>
  )
}

function AgentMentionKeyHandler({
  highlightIndex,
  setHighlightIndex,
  items,
  onSelect,
  onDismiss,
  anchorRef,
}: {
  highlightIndex: number
  setHighlightIndex: (i: number) => void
  items: AgentMenuItem[]
  onSelect: (item: AgentMenuItem) => void
  onDismiss: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}) {
  useEffect(() => {
    const el = anchorRef.current
    if (!el) return

    const handler = (e: Event) => {
      const ke = e as KeyboardEvent
      if (ke.key === 'ArrowUp') {
        ke.preventDefault()
        setHighlightIndex(highlightIndex <= 0 ? items.length - 1 : highlightIndex - 1)
      } else if (ke.key === 'ArrowDown') {
        ke.preventDefault()
        setHighlightIndex(highlightIndex >= items.length - 1 ? 0 : highlightIndex + 1)
      } else if (isCommitEnter(ke) && !ke.ctrlKey && !ke.metaKey) {
        ke.preventDefault()
        if (items[highlightIndex]) onSelect(items[highlightIndex])
      } else if (ke.key === 'Escape') {
        ke.preventDefault()
        onDismiss()
      } else if (ke.key === 'Tab') {
        ke.preventDefault()
        if (items[highlightIndex]) onSelect(items[highlightIndex])
      }
    }

    el.addEventListener('keydown', handler, true)
    return () => el.removeEventListener('keydown', handler, true)
  }, [highlightIndex, items, onSelect, onDismiss, setHighlightIndex, anchorRef])

  return null
}

export function useAgentMention({
  workspaceId,
  input,
  setInput,
  inputRef,
}: {
  workspaceId: string
  input: string
  setInput: (v: string) => void
  inputRef: React.RefObject<HTMLElement | null>
}) {
  const [mentionVisible, setMentionVisible] = useState(false)
  const [mentionActive, setMentionActive] = useState(false)
  const cursorPosRef = useRef(0)

  // Cheap check: only do cursor work when input contains @
  const hasAt = input.includes('@')

  // Show/hide mention menu — read cursor from ref, no state update per keystroke
  useEffect(() => {
    if (!hasAt) {
      setMentionVisible(false)
      return
    }
    const el = inputRef.current as HTMLTextAreaElement | null
    if (el) cursorPosRef.current = el.selectionStart ?? 0
    const mention = getAtMention(input, cursorPosRef.current)
    setMentionVisible(!!mention)
  }, [input, hasAt, inputRef])

  const handleSelect = (item: AgentMenuItem) => {
    const el = inputRef.current as HTMLTextAreaElement | null
    if (el) cursorPosRef.current = el.selectionStart ?? 0
    const mention = getAtMention(input, cursorPosRef.current)
    if (!mention) return
    const before = input.slice(0, mention.start)
    const after = input.slice(mention.end)
    // File entry: insert `@file/` without trailing space so useFileMention takes over.
    // Agent entry: insert `@agent/<ref>` with trailing space.
    const inserted =
      item.kind === 'file' ? FILE_MENTION_PREFIX : `${AGENT_MENTION_PREFIX}${agentRef(item.agent)} `
    setInput(before + inserted + after)
    setMentionVisible(false)
    requestAnimationFrame(() => {
      if (el) {
        el.focus()
        const pos = mention.start + inserted.length
        el.setSelectionRange(pos, pos)
      }
    })
  }

  const handleDismiss = () => setMentionVisible(false)

  const menu = (
    <AgentMentionMenu
      workspaceId={workspaceId}
      input={input}
      cursorPos={cursorPosRef.current}
      onSelect={handleSelect}
      onDismiss={handleDismiss}
      visible={mentionVisible}
      anchorRef={inputRef}
      onActiveChange={setMentionActive}
    />
  )

  return { mentionVisible: mentionActive, mentionMenu: menu }
}
