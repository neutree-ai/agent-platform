import { PromptViewer } from '@/components/prompt/PromptViewer'
import { LAYOUTS, isLayoutId } from '@/components/shell/layout/layouts'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useSlotContext } from '@/contexts/SlotContext'
import { api } from '@/lib/api/client'
import type { McpCatalogEntry } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { setPersistentInstanceState } from '@/stores/instance-state-store'
import { useQuery } from '@tanstack/react-query'
import {
  BookOpen,
  Box,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  ExternalLink,
  FileText,
  LayoutPanelLeft,
  type LucideIcon,
  Server,
  Settings,
  SquareTerminal,
} from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

interface TemplateConfigViewProps {
  agentType?: string
  providerName?: string
  model?: string
  smallModel?: string
  promptId?: string
  promptName?: string
  promptContent?: string
  mcpServers?: Record<string, { type?: string; command?: string; url?: string }>
  agentSettings?: Record<string, unknown>
  skillNames?: string[]
  resources?: {
    cpuRequest?: string
    cpuLimit?: string
    memoryRequest?: string
    memoryLimit?: string
    storage?: string
    presetLabel?: string
  }
  commands?: { name: string; type: string; prompt_id: string | null; content: string }[]
  schedules?: { name: string; cron: string; timezone: string; enabled_default: boolean }[]
  /** workspace_layout id the version ships (resolved + shown read-only). */
  layoutId?: string | null
}

/**
 * Read-only display of the layout a template version ships. Resolves the
 * referenced workspace_layout by id (open read) to show its name, column frame,
 * and app count. A dangling link (builder deleted it) shows nothing.
 */
function LayoutSection({ layoutId }: { layoutId: string }) {
  const { t } = useTranslation()
  const { data: layout } = useQuery({
    queryKey: ['workspace-layout', layoutId],
    queryFn: () => api.getWorkspaceLayout(layoutId),
  })
  if (!layout) return null
  const frame = isLayoutId(layout.skeleton.layout_id) ? LAYOUTS[layout.skeleton.layout_id] : null
  const appCount = Object.values(layout.skeleton.slots ?? {}).reduce(
    (n, apps) => n + apps.length,
    0,
  )
  return (
    <DetailSection
      icon={LayoutPanelLeft}
      title={t('components.library.templateConfigView.sections.layout')}
    >
      <SectionRow label={layout.name}>
        <span className="truncate text-muted-foreground">
          {`${frame ? t(frame.labelKey) : layout.skeleton.layout_id} · ${t(
            'components.library.templateConfigView.appsCount',
            { count: appCount },
          )}`}
        </span>
      </SectionRow>
    </DetailSection>
  )
}

/**
 * Section block — bold title + soft rounded card body, mirroring the
 * "title + grouped card" shape macOS Settings uses for detail panes.
 * Multiple rows inside the card are separated by hairlines so the card
 * reads as a list, not a slab.
 */
function DetailSection({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 px-1 text-sm font-semibold text-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/70" strokeWidth={2} />
        {title}
      </h3>
      <div className="divide-y divide-foreground/[0.05] rounded-xl bg-foreground/[0.04]">
        {children}
      </div>
    </div>
  )
}

/**
 * One row inside a DetailSection card. Use `label` for a flat
 * key-on-left, value-on-right setting; pass plain children when the
 * row carries arbitrary content (e.g. a chip cluster, an inline
 * collapsible). The hairline divider between siblings comes from the
 * parent's `divide-y`, no need to add one here.
 */
function SectionRow({
  label,
  children,
  className,
}: {
  label?: ReactNode
  children: ReactNode
  className?: string
}) {
  if (label !== undefined) {
    return (
      <div className={cn('flex items-center justify-between gap-3 px-3 py-2.5 text-xs', className)}>
        <span className="shrink-0 text-muted-foreground">{label}</span>
        <div className="flex min-w-0 items-center justify-end text-right text-foreground">
          {children}
        </div>
      </div>
    )
  }
  return <div className={cn('px-3 py-2.5 text-xs', className)}>{children}</div>
}

/**
 * Hop into the Library app at a specific section + select a specific
 * item. Used for prompt/skill cross-references inside the template
 * config view so users can land on the source artifact.
 */
function useJumpToLibrary() {
  const slotCtx = useSlotContext()
  const { workspaceId: paramWs } = useParams<{ workspaceId?: string }>()
  // Prefer the SlotContext profile id so this works in fleet scope where
  // the URL has no :workspaceId — same fallback shape useInstancePersistentState uses.
  const workspaceId = slotCtx?.workspaceId ?? paramWs
  return (section: 'prompts' | 'skills' | 'templates', selectedId?: string) => {
    if (!slotCtx || !workspaceId) return
    const { slotId, instanceId } = slotCtx.ensureInstance('library')
    setPersistentInstanceState(workspaceId, instanceId, 'librarySection', section)
    if (selectedId) {
      const stateKey =
        section === 'prompts'
          ? 'promptsSelectedId'
          : section === 'templates'
            ? 'templatesSelectedId'
            : 'skillsSelectedId'
      setPersistentInstanceState(workspaceId, instanceId, stateKey, selectedId)
    }
    slotCtx.activate(slotId, instanceId)
  }
}

/** Tiny copy-to-clipboard button used inline next to mono targets. */
function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const onClick = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    toast.success(label ? `${label} copied` : 'Copied')
    setTimeout(() => setCopied(false), 1600)
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground"
      title={label ?? 'Copy'}
    >
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

function PromptPreview({ id, name, content }: { id?: string; name?: string; content?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const jump = useJumpToLibrary()

  if (!name && !content) {
    return (
      <span className="text-xs text-muted-foreground/40">
        {t('components.library.templateConfigView.empty.value')}
      </span>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group/prompt flex items-center gap-1.5 text-xs">
        {/* Whole row toggles preview — chevron + label sit inside one
            wide trigger so the hit target isn't just the chevron icon. */}
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left hover:text-foreground">
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
          )}
          {name ? (
            <span className="truncate text-foreground">{name}</span>
          ) : content ? (
            <span className="italic text-muted-foreground/60">
              {t('components.library.templateConfigView.labels.custom')}
            </span>
          ) : null}
        </CollapsibleTrigger>
        {/* Jump-to-source is a separate hover affordance so it doesn't
            steal the toggle interaction from the row. */}
        {id && (
          <button
            type="button"
            onClick={() => jump('prompts', id)}
            className="shrink-0 text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground group-hover/prompt:opacity-100"
            title={t('components.library.templateConfigView.actions.openInLibrary', {
              defaultValue: 'Open in library',
            })}
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </div>
      {content && (
        <CollapsibleContent>
          <PromptViewer content={content} variant="inline" maxHeight="12rem" className="mt-1.5" />
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

/**
 * Single MCP server row. Resolves the server name against the platform
 * catalog so well-known servers (github, linear, ...) render with their
 * marketing label + description; unknown / custom servers fall back to
 * the raw name.
 */
function McpServerRow({
  name,
  cfg,
  catalogEntry,
}: {
  name: string
  cfg: { type?: string; command?: string; url?: string }
  catalogEntry?: McpCatalogEntry
}) {
  const { t } = useTranslation()
  const transport = cfg.type || (cfg.command ? 'stdio' : cfg.url ? 'http' : '?')
  const target = cfg.url || cfg.command || ''
  const label = catalogEntry?.label ?? name
  const description = catalogEntry?.description

  return (
    <SectionRow>
      <div className="flex items-baseline gap-2">
        <span className="truncate text-sm font-medium text-foreground">{label}</span>
        {catalogEntry && (
          <span className="font-mono text-tiny text-muted-foreground/60">{catalogEntry.id}</span>
        )}
        <span className="ml-auto shrink-0 rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-tiny text-muted-foreground">
          {transport}
        </span>
      </div>
      {description && (
        <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{description}</div>
      )}
      {target && (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
          <span
            className="min-w-0 flex-1 truncate font-mono text-tiny text-muted-foreground/80"
            title={target}
          >
            {target}
          </span>
          <CopyButton
            value={target}
            label={t('components.library.templateConfigView.sections.mcpServers')}
          />
        </div>
      )}
    </SectionRow>
  )
}

export function TemplateConfigView({
  agentType,
  providerName,
  model,
  smallModel,
  promptId,
  promptName,
  promptContent,
  mcpServers,
  agentSettings,
  skillNames,
  resources,
  commands,
  schedules,
  layoutId,
}: TemplateConfigViewProps) {
  const { t } = useTranslation()
  const jump = useJumpToLibrary()
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false)

  // Cache shared with McpConfigEditor and other surfaces — same query key.
  const catalogQuery = useQuery<McpCatalogEntry[]>({
    queryKey: ['mcp-catalog'],
    queryFn: () => api.getMcpCatalog(),
    enabled: !!mcpServers && Object.keys(mcpServers).length > 0,
    staleTime: 5 * 60 * 1000,
  })
  const catalogById = useMemo(() => {
    const m = new Map<string, McpCatalogEntry>()
    for (const entry of catalogQuery.data ?? []) m.set(entry.id, entry)
    return m
  }, [catalogQuery.data])

  const agentSettingsKeyCount = agentSettings ? Object.keys(agentSettings).length : 0

  return (
    <div className="max-w-2xl space-y-6 text-xs">
      <DetailSection icon={Box} title={t('components.library.templateConfigView.sections.model')}>
        {agentType && (
          <SectionRow label={t('components.modelFields.labels.agentType')}>
            <span className="truncate">{agentType}</span>
          </SectionRow>
        )}
        {providerName && (
          <SectionRow label={t('components.modelFields.labels.provider')}>
            <span className="truncate">{providerName}</span>
          </SectionRow>
        )}
        <SectionRow label={t('components.modelFields.labels.model')}>
          <span className="truncate font-mono">
            {model || t('components.library.templateConfigView.empty.value')}
          </span>
        </SectionRow>
        {smallModel && (
          <SectionRow label={t('components.modelFields.labels.smallModel')}>
            <span className="truncate font-mono">{smallModel}</span>
          </SectionRow>
        )}
      </DetailSection>

      <DetailSection
        icon={FileText}
        title={t('components.library.templateConfigView.sections.prompt')}
      >
        <SectionRow>
          <PromptPreview id={promptId} name={promptName} content={promptContent} />
        </SectionRow>
      </DetailSection>

      {mcpServers && Object.keys(mcpServers).length > 0 && (
        <DetailSection
          icon={Server}
          title={t('components.library.templateConfigView.sections.mcpServers')}
        >
          {Object.entries(mcpServers).map(([name, cfg]) => (
            <McpServerRow key={name} name={name} cfg={cfg} catalogEntry={catalogById.get(name)} />
          ))}
        </DetailSection>
      )}

      {agentSettings && agentSettingsKeyCount > 0 && (
        <DetailSection
          icon={Settings}
          title={t('components.library.templateConfigView.sections.agentSettings')}
        >
          <Collapsible open={agentSettingsOpen} onOpenChange={setAgentSettingsOpen}>
            <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-xs hover:text-foreground">
              {agentSettingsOpen ? (
                <ChevronDown className="h-3 w-3 text-muted-foreground/60" />
              ) : (
                <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
              )}
              <span className="text-muted-foreground">{`${agentSettingsKeyCount} keys`}</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mx-3 mb-3 max-h-48 overflow-x-auto whitespace-pre-wrap rounded-md border border-foreground/[0.06] bg-background/50 px-3 py-2 font-mono text-tiny text-foreground/80">
                {JSON.stringify(agentSettings, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        </DetailSection>
      )}

      <DetailSection icon={BookOpen} title={t('pages.library.navigation.skills')}>
        <SectionRow>
          {skillNames && skillNames.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {skillNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => jump('skills')}
                  className="rounded bg-foreground/[0.06] px-2 py-0.5 font-mono text-tiny text-muted-foreground transition-colors hover:bg-foreground/[0.10] hover:text-foreground"
                >
                  {name}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground/40">
              {t('components.library.templateConfigView.empty.value')}
            </span>
          )}
        </SectionRow>
      </DetailSection>

      {resources && (
        <DetailSection
          icon={Cpu}
          title={t('components.library.templateConfigView.sections.resources')}
        >
          {resources.presetLabel && (
            <SectionRow
              label={t('components.library.templateConfigView.labels.preset', {
                defaultValue: 'Preset',
              })}
            >
              <span className="truncate font-medium">{resources.presetLabel}</span>
            </SectionRow>
          )}
          <SectionRow
            label={t('components.library.templateConfigView.labels.cpu', {
              defaultValue: 'CPU',
            })}
          >
            <span className="font-mono">
              {resources.cpuRequest || '?'} / {resources.cpuLimit || '?'}
            </span>
          </SectionRow>
          <SectionRow
            label={t('components.library.templateConfigView.labels.memory', {
              defaultValue: 'Memory',
            })}
          >
            <span className="font-mono">
              {resources.memoryRequest || '?'} / {resources.memoryLimit || '?'}
            </span>
          </SectionRow>
          <SectionRow
            label={t('components.library.templateConfigView.labels.storage', {
              defaultValue: 'Storage',
            })}
          >
            <span className="font-mono">{resources.storage || '?'}</span>
          </SectionRow>
        </DetailSection>
      )}

      {commands && commands.length > 0 && (
        <DetailSection icon={SquareTerminal} title={t('components.automation.sections.commands')}>
          {commands.map((c) => (
            <SectionRow key={c.name} label={<span className="font-mono">/{c.name}</span>}>
              <span className="truncate text-muted-foreground">
                {t(`components.configCommands.types.${c.type}`)}
              </span>
            </SectionRow>
          ))}
        </DetailSection>
      )}

      {schedules && schedules.length > 0 && (
        <DetailSection icon={CalendarClock} title={t('components.automation.sections.schedules')}>
          {schedules.map((s) => (
            <SectionRow key={s.name} label={s.name}>
              <span className="truncate font-mono text-muted-foreground">
                {s.cron} · {s.timezone}
              </span>
            </SectionRow>
          ))}
        </DetailSection>
      )}

      {layoutId && <LayoutSection layoutId={layoutId} />}
    </div>
  )
}
