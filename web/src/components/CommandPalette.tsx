import { useDialogStack } from '@/contexts/DialogStackContext'
import { useSlotContext } from '@/contexts/SlotContext'
import { useFleetApps } from '@/hooks/useFleetApps'
import { useWorkspaces } from '@/hooks/useWorkspaces'
import type { AppDefinition } from '@/lib/app-registry'
import { i18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Command as CommandPrimitive } from 'cmdk'
import {
  Activity,
  AppWindow,
  Bell,
  Blocks,
  BookOpen,
  Boxes,
  Brain,
  Cable,
  Compass,
  CornerDownLeft,
  Database,
  FolderOpen,
  Globe,
  Handshake,
  History,
  Key,
  KeyRound,
  LayoutGrid,
  type LucideIcon,
  MessageSquare,
  Network,
  Puzzle,
  Search,
  Settings2,
  ShieldCheck,
  Sliders,
  SquareTerminal,
  Tag,
  Users,
  Zap,
} from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

// ─── Types ──────────────────────────────────────────────────────────

type Scope = 'fleet' | 'ws'

type Action =
  | { type: 'navigate'; to: string }
  | { type: 'activateApp'; appId: string }
  | { type: 'openDialog'; dialog: string }
  | { type: 'external'; href: string }

type WorkspaceItem = {
  kind: 'workspace'
  key: string
  label: string
  searchText: string
  recency: number
  status: string
  human: number
  agent: number
  action: Action
}

type AppItem = {
  kind: 'app'
  key: string
  label: string
  searchText: string
  appId: string
  action: Action
}

type CommandItem = {
  kind: 'command'
  key: string
  label: string
  searchText: string
  icon: LucideIcon
  action: Action
}

type Item = WorkspaceItem | AppItem | CommandItem

interface Context {
  scope: Scope
  workspaceId: string | undefined
}

// ─── Sources (hooks) ────────────────────────────────────────────────

function useWorkspaceItems(ctx: Context): WorkspaceItem[] {
  const { data: workspaces } = useWorkspaces()
  return useMemo(() => {
    if (!workspaces) return []
    return workspaces
      .filter((w) => ctx.scope !== 'ws' || w.id !== ctx.workspaceId)
      .map((w, i) => ({
        kind: 'workspace' as const,
        key: `workspace:${w.id}`,
        label: w.name,
        searchText: w.name.toLowerCase(),
        recency: 1 / (1 + i),
        status: w.status ?? 'stopped',
        human: w.active_human_sessions ?? 0,
        agent: w.active_agent_sessions ?? 0,
        action: { type: 'navigate', to: `/w/${w.id}` },
      }))
    // navigate is stable from react-router; ctx values come from props
  }, [workspaces, ctx.scope, ctx.workspaceId])
}

/**
 * English-side search aliases for built-in apps. Per-locale aliases live in
 * `commandPalette.appKeywords.*` in each locale file. At lookup time we pull
 * aliases from every loaded locale regardless of UI language, so search stays
 * cross-lingual (a user on any UI can still match an app by a localized term).
 *
 * Plugin apps fall through to label-only matching — we don't know their
 * domain vocabulary upfront.
 */
const APP_KEYWORDS_EN: Record<string, string> = {
  // ws-scoped
  chat: 'chat conversation',
  sessions: 'sessions history',
  memory: 'memory',
  settings: 'settings configuration agent',
  files: 'files file fs',
  terminal: 'terminal shell',
  browser: 'browser web',
  sandboxes: 'sandbox sandboxes',
  skills: 'skills skill',
  automation: 'automation auto schedule',
  library: 'library prompts templates',
  connectors: 'connectors integration mcp',
  'service-tokens': 'service tokens token',
  credentials: 'credentials secret ssh key',
  models: 'models provider llm api',
  teams: 'teams team',
  'oauth-apps': 'oauth applications app',
  admin: 'admin administration',
  // fleet-only
  workspaces: 'workspaces ws',
  tags: 'tags label',
  activity: 'activity inbox',
  'memory-stores': 'memory stores',
  teamwork: 'teamwork collaboration',
}

// Gather a keyword key's value across every loaded locale, so search stays
// cross-lingual without hardcoding a specific language. Skips i18next's
// 'cimode' sentinel and any locale missing the key.
function localizedKeywords(key: string): string {
  const langs = i18n.options.supportedLngs
  const list = Array.isArray(langs) ? langs : [i18n.language]
  return list
    .filter((lng) => lng && lng !== 'cimode')
    .map((lng) => i18n.t(key, { lng, defaultValue: '' }))
    .filter(Boolean)
    .join(' ')
}

function appAliases(id: string): string {
  const en = APP_KEYWORDS_EN[id] ?? ''
  const localized = localizedKeywords(`components.commandPalette.appKeywords.${id}`)
  return `${en} ${localized}`.trim()
}

function useAppItems(ctx: Context): AppItem[] {
  const slotCtx = useSlotContext()
  const fleetApps = useFleetApps()
  // In ws scope we read apps from slot context (already resolved by
  // useWsApps in Desktop). In fleet scope we still want fleet apps even
  // when the slot provider hasn't mounted yet, so useFleetApps directly.
  const apps: AppDefinition[] = ctx.scope === 'ws' ? (slotCtx?.apps ?? []) : fleetApps
  return useMemo(() => {
    return apps
      .filter((a) => !a.hidden)
      .map((a) => {
        const aliases = appAliases(a.id)
        const searchText = `${a.label.toLowerCase()} ${a.id.replace(/-/g, ' ')} ${aliases.toLowerCase()}`
        return {
          kind: 'app' as const,
          key: `app:${a.id}`,
          label: a.label,
          searchText,
          appId: a.id,
          action: { type: 'activateApp' as const, appId: a.id },
        }
      })
  }, [apps])
}

function useCommandItems(_ctx: Context): CommandItem[] {
  const { t } = useTranslation()
  return useMemo(() => {
    // ⌘K is about "where to go". Creation actions (new prompt/skill/connector/...)
    // are handled by their own app entries and aren't duplicated here, which avoids
    // corner cases where a dialog fires in the wrong scope. Keep only global
    // actions that have no dedicated app.
    const all: CommandItem[] = [
      {
        kind: 'command',
        key: 'cmd:preferences',
        label: t('components.commandPalette.items.preferences'),
        searchText:
          `preferences settings theme sound notification language ${localizedKeywords('components.commandPalette.commandKeywords.preferences')}`.toLowerCase(),
        icon: Settings2,
        action: { type: 'openDialog', dialog: 'preferences' },
      },
    ]
    all.push({
      kind: 'command',
      key: 'cmd:api-docs',
      label: t('components.commandPalette.items.apiDocumentation'),
      searchText:
        `api documentation swagger openapi ${localizedKeywords('components.commandPalette.commandKeywords.apiDocumentation')}`.toLowerCase(),
      icon: BookOpen,
      action: { type: 'external', href: '/api/docs' },
    })
    if (import.meta.env.VITE_DOCS_URL) {
      all.push({
        kind: 'command',
        key: 'cmd:docs',
        label: t('components.commandPalette.items.documentation'),
        searchText:
          `documentation docs help api ${localizedKeywords('components.commandPalette.commandKeywords.documentation')}`.toLowerCase(),
        icon: Compass,
        action: { type: 'external', href: import.meta.env.VITE_DOCS_URL as string },
      })
    }
    return all
  }, [t])
}

// ─── Ranking ────────────────────────────────────────────────────────

// Workspaces lead in both scopes — keeps ⌘K muscle memory consistent
// (top-of-list = navigation). Apps still surface fast on direct name
// queries because fuzzy bonuses (prefix / word-boundary / short-label)
// dominate the base weight when there's a real match.
const BASE_WEIGHT: Record<Scope, Record<Item['kind'], number>> = {
  fleet: { workspace: 1.0, app: 0.6, command: 0.4 },
  ws: { workspace: 1.0, app: 0.7, command: 0.4 },
}

/**
 * Substring fuzzy with anchoring bonuses. Returns 0 when query doesn't
 * match at all (so item is filtered out). Higher = better.
 *
 * Bonuses (tunable):
 *   - prefix match:           +1.5
 *   - word-boundary match:    +0.8
 *   - shorter label wins:     small bias via 1/sqrt(label.length)
 */
function fuzzyScore(query: string, searchText: string, label: string): number {
  if (!query) return 1
  const q = query.toLowerCase().trim()
  const idx = searchText.indexOf(q)
  if (idx < 0) return 0
  const labelLower = label.toLowerCase()
  let score = 1
  if (labelLower.startsWith(q)) score += 1.5
  else if (idx === 0) score += 1.0
  // Word-boundary hit (preceded by space / hyphen / dash)
  const before = searchText[idx - 1]
  if (idx > 0 && (before === ' ' || before === '-' || before === '_')) score += 0.8
  // Shorter labels resolve ambiguity (so "Files" beats "File preview" on "fi").
  score += 1 / Math.sqrt(label.length || 1)
  return score
}

function rankItems(items: Item[], query: string, ctx: Context): Item[] {
  const scored: { item: Item; score: number }[] = []
  for (const item of items) {
    const fuzz = fuzzyScore(query, item.searchText, item.label)
    if (fuzz === 0) continue
    const recency = item.kind === 'workspace' ? item.recency : 1
    const base = BASE_WEIGHT[ctx.scope][item.kind]
    scored.push({ item, score: fuzz * base * recency })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.item)
}

// ─── Component ──────────────────────────────────────────────────────

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const dialogs = useDialogStack()
  const slotCtx = useSlotContext()
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  const scope: Scope = workspaceId ? 'ws' : 'fleet'
  const ctx: Context = { scope, workspaceId }

  const wsItems = useWorkspaceItems(ctx)
  const appItems = useAppItems(ctx)
  const cmdItems = useCommandItems(ctx)

  // Per-keystroke ranking. Kept local — palette resets on close.
  // Inputs are tiny (≤200 ws + ~15 apps + ~10 commands), no need to
  // memoize across renders.
  function getRanked(query: string): Item[] {
    return rankItems([...wsItems, ...appItems, ...cmdItems], query, ctx)
  }

  function handleSelect(action: Action) {
    // Run the side-effect FIRST, then close. Closing first triggers Radix's
    // focus-restoration cascade which can swallow the followup activate.
    if (action.type === 'navigate') {
      navigate(action.to)
    } else if (action.type === 'external') {
      window.open(action.href, '_blank')
    } else if (action.type === 'openDialog') {
      dialogs.open(action.dialog)
    } else if (action.type === 'activateApp') {
      if (slotCtx) {
        const { slotId, instanceId } = slotCtx.ensureInstance(action.appId)
        // If this slot is hidden by the current filled-slot mode, lift the
        // fill so the activated app becomes visible.
        if (slotCtx.filledSlot && slotCtx.filledSlot !== slotId) {
          slotCtx.setFilledSlot(null)
        }
        slotCtx.activate(slotId, instanceId)
      }
    }
    onOpenChange(false)
  }

  const modKey = navigator.platform?.includes('Mac') ? '⌘K' : 'Ctrl+K'

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-foreground/20',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'duration-100',
          )}
        />
        <DialogPrimitive.Content
          aria-label={t('components.commandPalette.title')}
          className={cn(
            'fixed left-[50%] top-[18%] z-50 w-full max-w-xl -translate-x-1/2',
            'overflow-hidden rounded-xl border border-foreground/[0.08]',
            'bg-popover text-popover-foreground',
            'shadow-2xl shadow-foreground/[0.12] ring-1 ring-inset ring-foreground/[0.03]',
            'will-change-[opacity,transform]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'duration-100',
          )}
        >
          {/* a11y title for screen readers; visually hidden */}
          <DialogPrimitive.Title className="sr-only">
            {t('components.commandPalette.title')}
          </DialogPrimitive.Title>
          <CommandPrimitive
            shouldFilter={false}
            label={t('components.commandPalette.title')}
            className="flex h-full w-full flex-col"
          >
            <PaletteBody
              modKey={modKey}
              getRanked={getRanked}
              onSelect={handleSelect}
              emptyLabel={t('components.commandPalette.empty')}
              placeholder={t('components.commandPalette.searchPlaceholder')}
              hintPrefix={t('components.commandPalette.tip.prefix')}
              hintSuffix={t('components.commandPalette.tip.suffix')}
            />
          </CommandPrimitive>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

interface PaletteBodyProps {
  modKey: string
  getRanked: (q: string) => Item[]
  onSelect: (a: Action) => void
  emptyLabel: string
  placeholder: string
  hintPrefix: string
  hintSuffix: string
}

function PaletteBody({
  modKey,
  getRanked,
  onSelect,
  emptyLabel,
  placeholder,
  hintPrefix,
  hintSuffix,
}: PaletteBodyProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const ranked = useMemo(() => getRanked(query), [query, getRanked])
  const groups = groupByKind(ranked, t)

  return (
    <>
      <div className="relative flex items-center border-b border-foreground/[0.08] px-4">
        <Search aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground/70" />
        <CommandPrimitive.Input
          value={query}
          onValueChange={setQuery}
          placeholder={placeholder}
          className={cn(
            'flex h-12 w-full bg-transparent pl-3 pr-2 text-sm',
            'text-foreground placeholder:text-muted-foreground/60',
            'outline-none',
          )}
        />
        <kbd
          className={cn(
            'ml-2 shrink-0 rounded border border-foreground/[0.10] bg-foreground/[0.04]',
            'px-1.5 py-0.5 text-mini font-medium tracking-wider text-muted-foreground/80',
          )}
        >
          esc
        </kbd>
      </div>

      <CommandPrimitive.List
        className={cn(
          'max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain',
          'p-1.5',
          // cmdk groups: tighten default spacing
          '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2',
          '[&_[cmdk-group-heading]]:text-mini [&_[cmdk-group-heading]]:font-medium',
          '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider',
          '[&_[cmdk-group-heading]]:text-muted-foreground/55',
        )}
      >
        <CommandPrimitive.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
          {emptyLabel}
        </CommandPrimitive.Empty>
        {groups.map((g) => (
          <CommandPrimitive.Group key={g.kind} heading={g.heading}>
            {g.items.map((item) => (
              <Row key={item.key} item={item} onSelect={onSelect} />
            ))}
          </CommandPrimitive.Group>
        ))}
      </CommandPrimitive.List>

      <div
        className={cn(
          'flex items-center justify-between gap-2 border-t border-foreground/[0.08]',
          'bg-foreground/[0.015] px-3 py-2 text-mini text-muted-foreground/60',
        )}
      >
        <span>
          {hintPrefix}{' '}
          <kbd className="rounded bg-foreground/[0.06] px-1 py-0.5 font-medium text-muted-foreground/85">
            {modKey}
          </kbd>{' '}
          {hintSuffix}
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded bg-foreground/[0.06] px-1 py-0.5 font-medium text-muted-foreground/85">
            ↑↓
          </kbd>
          <kbd className="inline-flex items-center gap-0.5 rounded bg-foreground/[0.06] px-1 py-0.5 font-medium text-muted-foreground/85">
            <CornerDownLeft className="h-2.5 w-2.5" />
          </kbd>
        </span>
      </div>
    </>
  )
}

// ─── Grouping & Row ─────────────────────────────────────────────────

interface Group {
  kind: Item['kind']
  heading: string
  items: Item[]
}

function groupByKind(items: Item[], t: (k: string) => string): Group[] {
  // Group order follows first-occurrence in the ranked list, so the
  // top-scoring kind floats up naturally on each query change.
  const byKind = new Map<Item['kind'], Item[]>()
  for (const it of items) {
    const arr = byKind.get(it.kind) ?? []
    arr.push(it)
    byKind.set(it.kind, arr)
  }
  const HEADING: Record<Item['kind'], string> = {
    workspace: t('components.commandPalette.groups.workspaces'),
    app: t('components.commandPalette.groups.apps'),
    command: t('components.commandPalette.groups.commands'),
  }
  return Array.from(byKind.entries()).map(([kind, list]) => ({
    kind,
    heading: HEADING[kind],
    items: list,
  }))
}

interface RowProps {
  item: Item
  onSelect: (a: Action) => void
}

const TONE_DOT: Record<string, string> = {
  running: 'bg-success',
  starting: 'bg-warning',
  stopping: 'bg-warning',
  pending: 'bg-warning',
  error: 'bg-destructive',
  stopped: 'bg-muted-foreground/30',
}

function statusToneClass(status: string): string {
  const s = status.toLowerCase()
  if (s.includes('error') || s.includes('fail')) return TONE_DOT.error
  if (s === 'running') return TONE_DOT.running
  if (s.includes('start') || s.includes('stopping') || s.includes('pending'))
    return TONE_DOT.starting
  return TONE_DOT.stopped
}

const APP_ICONS: Record<string, LucideIcon> = {
  // ws-scoped
  chat: MessageSquare,
  sessions: History,
  memory: Brain,
  settings: Sliders,
  files: FolderOpen,
  terminal: SquareTerminal,
  browser: Globe,
  sandboxes: Boxes,
  skills: Puzzle,
  automation: Zap,
  library: BookOpen,
  connectors: Cable,
  'service-tokens': Key,
  credentials: KeyRound,
  models: Network,
  teams: Users,
  'oauth-apps': AppWindow,
  admin: ShieldCheck,
  // fleet-scoped
  workspaces: LayoutGrid,
  tags: Tag,
  activity: Activity,
  'memory-stores': Database,
  teamwork: Handshake,
}

function Row({ item, onSelect }: RowProps) {
  // Per-kind body content
  let icon: ReactNode
  let text: ReactNode
  let aside: ReactNode = null

  if (item.kind === 'workspace') {
    icon = (
      <span
        aria-hidden
        className={cn(
          'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
          statusToneClass(item.status),
        )}
      />
    )
    text = <span className="truncate">{item.label}</span>
    if (item.human > 0 || item.agent > 0) {
      aside = (
        <span className="inline-flex shrink-0 items-center gap-1">
          {item.human > 0 && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-1.5 py-0',
                'bg-warning/15 text-warning text-mini font-medium tabular-nums',
              )}
            >
              <Bell aria-hidden className="h-2.5 w-2.5" />
              {item.human}
            </span>
          )}
          {item.agent > 0 && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-1.5 py-0',
                'bg-foreground/[0.06] text-muted-foreground text-mini font-medium tabular-nums',
              )}
            >
              <Activity aria-hidden className="h-2.5 w-2.5" />
              {item.agent}
            </span>
          )}
        </span>
      )
    }
  } else if (item.kind === 'app') {
    // Plugin / MCP-driven apps aren't in APP_ICONS — give them a generic
    // extension glyph rather than a blank tile.
    const Icon = APP_ICONS[item.appId] ?? Blocks
    icon = <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
    text = <span className="truncate">{item.label}</span>
  } else {
    const Icon = item.icon
    icon = <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
    text = <span className="truncate">{item.label}</span>
  }

  return (
    <CommandPrimitive.Item
      value={item.key}
      onSelect={() => onSelect(item.action)}
      className={cn(
        'group relative flex w-full cursor-pointer items-center justify-between gap-3',
        'rounded-md pl-3.5 pr-2.5 py-2 text-sm text-muted-foreground/90',
        'transition-colors duration-150',
        'data-[selected=true]:bg-foreground/[0.05]',
        'data-[selected=true]:text-foreground',
        // Selected accent: 3px gradient stripe (echoing WsSwitcher's active state)
        'before:pointer-events-none before:absolute before:left-1 before:top-1/2',
        'before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-full',
        'before:bg-gradient-to-b before:from-foreground/30 before:to-primary',
        'before:opacity-0 before:transition-opacity before:duration-150',
        'data-[selected=true]:before:opacity-100',
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {icon}
        {text}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {aside}
        {/* Enter glyph — fades in on the selected row to confirm intent. */}
        <CornerDownLeft
          aria-hidden
          className={cn(
            'h-3 w-3 text-muted-foreground/60 opacity-0 transition-opacity duration-150',
            'group-data-[selected=true]:opacity-100',
          )}
        />
      </span>
    </CommandPrimitive.Item>
  )
}
