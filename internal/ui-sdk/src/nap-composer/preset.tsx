import { Bot, File as FileIcon, Folder, Library } from 'lucide-react'
import { useMemo, useRef } from 'react'
import type {
  ComposerCommand,
  ComposerTrigger,
  ComposerTriggerItem,
  ComposerVoice,
} from '../composer/types'
import { useSdkTranslation } from '../i18n'
import type {
  NapCallableAgent,
  NapComposerClient,
  NapDirEntry,
  NapTranscribeOptions,
} from './client'
import { CREATE_SKILL_PROMPT } from './create-skill-prompt'

// ─── Built-in commands ──────────────────────────────────────────────

export type NapBuiltinCommandName = 'compact' | 'create-skill' | 'goal'

/** Names reserved by the built-in commands; workspace commands may not reuse them. */
export const NAP_BUILTIN_COMMAND_NAMES: readonly NapBuiltinCommandName[] = [
  'compact',
  'create-skill',
  'goal',
]

function builtinCommand(name: NapBuiltinCommandName): ComposerCommand {
  switch (name) {
    case 'compact':
      return { name, type: 'plain', content: '/compact' }
    case 'create-skill':
      return { name, type: 'struct', content: CREATE_SKILL_PROMPT }
    case 'goal':
      return { name, type: 'struct', content: '/goal {{condition}}' }
  }
}

/**
 * Whether an agent core acts on the text a built-in command sends. `compact`
 * and `goal` go out as literal `/compact` / `/goal …` prompts, which only work
 * on cores that parse slash commands out of the prompt text; `create-skill`
 * is an ordinary prompt driving the platform's skill tools and works anywhere.
 * An unknown or missing agent type is assumed to support everything.
 */
export function isNapBuiltinCommandSupported(
  name: NapBuiltinCommandName,
  agentType: string | undefined,
): boolean {
  switch (name) {
    case 'compact':
    case 'goal':
      return coreParsesSlashCommands(agentType)
    case 'create-skill':
      return true
  }
}

function coreParsesSlashCommands(agentType: string | undefined): boolean {
  switch (agentType) {
    // Its bridge hands prompt text to the harness verbatim; commands there go
    // through a separate command channel the bridge doesn't use.
    case 'dsh':
      return false
    // claude-code, codex and goose all dispatch `/compact` and `/goal`.
    default:
      return true
  }
}

// ─── Small caches ───────────────────────────────────────────────────

/** Stale-while-revalidate cell: cached values return synchronously. */
function swrCell<T>(load: () => Promise<T>, ttlMs: number) {
  let value: T | undefined
  let at = 0
  let inflight: Promise<T> | null = null
  const refresh = (): Promise<T> => {
    inflight ??= load()
      .then((v) => {
        value = v
        at = Date.now()
        return v
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }
  return (): T | Promise<T> => {
    if (value === undefined) return refresh()
    if (Date.now() - at > ttlMs) refresh().catch(() => {})
    return value
  }
}

/** Apply `fn` now for a plain value, or after resolution for a promise. */
function mapMaybeAsync<T, R>(v: T | Promise<T>, fn: (v: T) => R): R | Promise<R> {
  return v instanceof Promise ? v.then(fn) : fn(v)
}

// ─── Menu rows ──────────────────────────────────────────────────────

function FileMentionHint() {
  const { t } = useSdkTranslation()
  return <>{t('components.composer.nap.fileMentionHint')}</>
}

const FILE_PREFIX = '@file/'
const AGENT_PREFIX = '@agent/'
const FILE_LIST_LIMIT = 50

function agentRef(agent: NapCallableAgent): string {
  return agent.is_own ? agent.slug : `${agent.owner}/${agent.slug}`
}

function isDirEntry(entry: NapDirEntry): boolean {
  return entry.path_type === 'Dir' || entry.path_type === 'SymlinkDir'
}

/** `a/b/que` → `{ dir: 'a/b', query: 'que' }`. */
function splitPath(path: string): { dir: string; query: string } {
  const i = path.lastIndexOf('/')
  if (i === -1) return { dir: '', query: path }
  return { dir: path.slice(0, i), query: path.slice(i + 1) }
}

const fileEntryItem: ComposerTriggerItem = {
  key: '__file__',
  icon: <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />,
  label: (
    <span className="flex min-w-0 items-center gap-2">
      <span className="font-mono font-medium">{FILE_PREFIX}</span>
      <span className="truncate text-tiny text-muted-foreground">
        <FileMentionHint />
      </span>
    </span>
  ),
  // No trailing space: the `@file/` trigger takes over from here.
  insertText: FILE_PREFIX,
  keepOpen: true,
}

function agentItem(agent: NapCallableAgent): ComposerTriggerItem {
  const ref = agentRef(agent)
  return {
    key: agent.id,
    icon: <Bot className="h-3 w-3 shrink-0 text-muted-foreground" />,
    label: (
      <span className="flex min-w-0 items-center gap-2">
        <span className="font-mono font-medium">
          {AGENT_PREFIX}
          {ref}
        </span>
        <span className="truncate text-tiny text-muted-foreground">{agent.name}</span>
      </span>
    ),
    meta: agent.is_own ? undefined : agent.owner,
    insertText: `${AGENT_PREFIX}${ref} `,
  }
}

function dirEntryItem(entry: NapDirEntry, dir: string): ComposerTriggerItem {
  const entryIsDir = isDirEntry(entry)
  const path = `${FILE_PREFIX}${dir ? `${dir}/` : ''}${entry.name}`
  return {
    key: entry.name,
    icon: entryIsDir ? (
      <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
    ) : (
      <FileIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
    ),
    label: (
      <span className="font-mono">
        {entry.name}
        {entryIsDir ? '/' : ''}
      </span>
    ),
    // A folder keeps the picker open to drill in; a file ends the mention.
    insertText: entryIsDir ? `${path}/` : `${path} `,
    keepOpen: entryIsDir,
  }
}

function sortAndFilterEntries(entries: NapDirEntry[], query: string): NapDirEntry[] {
  const q = query.toLowerCase()
  return entries
    .filter((e) => e.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aDir = isDirEntry(a) ? 0 : 1
      const bDir = isDirEntry(b) ? 0 : 1
      if (aDir !== bDir) return aDir - bDir
      return a.name.localeCompare(b.name)
    })
    .slice(0, FILE_LIST_LIMIT)
}

// ─── Preset ─────────────────────────────────────────────────────────

export interface NapComposerInclude {
  /** All built-ins (`true`/`false`) or per command. Default: all on. */
  builtinCommands?: boolean | Partial<Record<NapBuiltinCommandName, boolean>>
  /** The workspace's own slash commands (needs `client.listCommands`). Default on. */
  workspaceCommands?: boolean
  /** `@file/…` workspace file mentions (needs `client.listDir`). Default on. */
  files?: boolean
  /** `@agent/…` callable-agent mentions (needs `client.listCallableAgents`). Default on. */
  agents?: boolean
  /** Voice input (needs `client.transcribe`). Default on. */
  voice?: boolean
}

export interface NapComposerOptions {
  client: NapComposerClient
  /** The workspace's agent core; built-ins it can't run are left out. */
  agentType?: string
  /** The current workspace, hidden from `@agent/…` suggestions. */
  workspaceId?: string
  include?: NapComposerInclude
  /** App commands, listed after the built-ins. */
  commands?: ComposerCommand[]
  voice?: NapTranscribeOptions & {
    /** Opt in to the page-wide ⌘/Ctrl+Shift+M toggle. */
    shortcut?: boolean
    onError?: (message: string) => void
  }
}

/** The subset of `ComposerProps` the preset fills in; spread it onto `<Composer>`. */
export interface NapComposerPreset {
  commands: ComposerCommand[]
  loadCommands?: () => Promise<ComposerCommand[]>
  triggers: ComposerTrigger[]
  voice?: ComposerVoice
}

const AGENTS_TTL_MS = 30_000
const FILES_TTL_MS = 10_000
const FILES_CACHE_MAX = 50

/**
 * Build composer data sources backed by the platform: built-in commands,
 * workspace commands, `@file/…`, `@agent/…` and voice. Each source can be
 * switched off through `include`. Not a hook — see {@link useNapComposer}
 * for the memoized React form.
 */
export function createNapComposerPreset(options: NapComposerOptions): NapComposerPreset {
  const { client, agentType, workspaceId, include = {} } = options

  const builtinFlags = include.builtinCommands ?? true
  const builtinOn = (name: NapBuiltinCommandName) =>
    (typeof builtinFlags === 'boolean' ? builtinFlags : (builtinFlags[name] ?? true)) &&
    isNapBuiltinCommandSupported(name, agentType)
  const commands = [
    ...NAP_BUILTIN_COMMAND_NAMES.filter(builtinOn).map(builtinCommand),
    ...(options.commands ?? []),
  ]

  const listCommands = include.workspaceCommands !== false ? client.listCommands : undefined
  const loadCommands = listCommands
    ? async (): Promise<ComposerCommand[]> =>
        (await listCommands())
          .filter((c) => !c.disabled)
          .map((c) => {
            const content = c.prompt_content || c.content
            return {
              name: c.name,
              type: c.type,
              content,
              icon: c.prompt_id ? Library : undefined,
            }
          })
    : undefined

  const triggers: ComposerTrigger[] = []
  const listDir = include.files !== false ? client.listDir : undefined
  const listAgents = include.agents !== false ? client.listCallableAgents : undefined

  if (listAgents || listDir) {
    const agents = listAgents ? swrCell(listAgents, AGENTS_TTL_MS) : () => []
    triggers.push({
      id: 'nap-agent',
      // Bare `@…` or `@agent/…`; `@file/…` belongs to the file trigger.
      pattern: /@(?!file\/)(?:agent\/)?([a-z0-9/-]*)$/,
      getItems: (query) =>
        mapMaybeAsync(agents(), (list) => {
          const showFileEntry =
            !!listDir && (query === '' || FILE_PREFIX.slice(1).startsWith(query))
          return [
            ...(showFileEntry ? [fileEntryItem] : []),
            ...list
              .filter((a) => a.id !== workspaceId && agentRef(a).includes(query))
              .map(agentItem),
          ]
        }),
    })
  }

  if (listDir) {
    const cache = new Map<string, { at: number; entries: NapDirEntry[] }>()
    triggers.push({
      id: 'nap-file',
      // Paths may contain spaces; only `@` (another mention) or a newline ends one.
      pattern: /@file\/([^@\n]*)$/,
      debounceMs: 150,
      header: (path) => {
        const { dir } = splitPath(path)
        return `${FILE_PREFIX}${dir ? `${dir}/` : ''}`
      },
      getItems: (path, signal) => {
        const { dir, query } = splitPath(path)
        const build = (entries: NapDirEntry[]) =>
          sortAndFilterEntries(entries, query).map((e) => dirEntryItem(e, dir))
        const key = `${dir}\u0000${query}`
        const hit = cache.get(key)
        if (hit && Date.now() - hit.at < FILES_TTL_MS) return build(hit.entries)
        return listDir(dir, query, signal).then(
          (entries) => {
            cache.set(key, { at: Date.now(), entries })
            if (cache.size > FILES_CACHE_MAX) {
              const oldest = cache.keys().next().value
              if (oldest !== undefined) cache.delete(oldest)
            }
            return build(entries)
          },
          () => [],
        )
      },
      // Narrow the previous listing by name while the new query loads.
      narrow: (items, path) => {
        const q = splitPath(path).query.toLowerCase()
        return items.filter((item) => item.key.toLowerCase().includes(q))
      },
    })
  }

  const transcribe = include.voice !== false ? client.transcribe : undefined
  const voiceOptions = options.voice
  const voice: ComposerVoice | undefined = transcribe
    ? {
        transcribe: (audio) =>
          transcribe(audio, { language: voiceOptions?.language, hint: voiceOptions?.hint }),
        shortcut: voiceOptions?.shortcut,
        onError: voiceOptions?.onError,
      }
    : undefined

  return { commands, loadCommands, triggers, voice }
}

/**
 * Memoized {@link createNapComposerPreset}. Keep `client` referentially stable
 * (e.g. `useMemo`); `commands` likewise. `voice.onError` may change freely.
 */
export function useNapComposer(options: NapComposerOptions): NapComposerPreset {
  const { client, agentType, workspaceId, include, commands, voice } = options
  const onErrorRef = useRef(voice?.onError)
  onErrorRef.current = voice?.onError
  const includeKey = JSON.stringify(include ?? {})
  const hasOnError = !!voice?.onError
  // `include` is compared by value (includeKey); onError is read through a ref.
  return useMemo(
    () =>
      createNapComposerPreset({
        client,
        agentType,
        workspaceId,
        include: JSON.parse(includeKey) as NapComposerInclude,
        commands,
        voice: {
          language: voice?.language,
          hint: voice?.hint,
          shortcut: voice?.shortcut,
          onError: hasOnError ? (message) => onErrorRef.current?.(message) : undefined,
        },
      }),
    [
      client,
      agentType,
      workspaceId,
      includeKey,
      commands,
      voice?.language,
      voice?.hint,
      voice?.shortcut,
      hasOnError,
    ],
  )
}
