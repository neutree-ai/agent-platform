import { Label } from '@/components/ui/label'
import type { AgentConfigSection } from '@/docs/inline-help/agent-config-docs'
import type { ComputeResources } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentSettingsEditor } from './AgentSettingsEditor'
import { CommandsField } from './CommandsField'
import { DEFAULTS, ResourceFields } from './ConfigResourcesButton'
import { McpConfigEditor } from './McpConfigEditor'
import { ModelFields } from './ModelFields'
import { PromptField } from './PromptField'
import { SchedulesField } from './SchedulesField'
import { SkillPicker } from './SkillPicker'

// ─── Shared config form values ─────────────────────────────────────

export interface TemplateCommandInput {
  name: string
  type: 'plain' | 'struct'
  prompt_id: string | null
  content: string
}

export interface TemplateScheduleInput {
  name: string
  cron: string
  timezone: string
  prompt: string
  prompt_id: string | null
  enabled_default: boolean
}

export interface ConfigFormValues {
  agent_type: string
  provider_id: string
  model: string
  small_model: string
  prompt_id: string
  mcp_config: string
  agent_settings: string
  compute_resources: ComputeResources
  /** p3: skill UUIDs (was skill_names pre-p3). */
  skill_ids: string[]
  /** Template-only: slash commands the version distributes (empty for plain workspaces). */
  commands: TemplateCommandInput[]
  /** Template-only: recurring schedules the version distributes. */
  schedules: TemplateScheduleInput[]
  /**
   * Template-only: the layout link the version ships. Not edited in this form —
   * carried through edit/rollback so saving a version doesn't drop the layout.
   */
  layout_id?: string | null
}

const AGENT_SETTINGS_DEFAULTS: Record<string, Record<string, any>> = {
  'claude-code': {
    permissions: { allow: [], deny: [] },
    enableAllProjectMcpServers: true,
  },
  codex: {},
}

function defaultAgentSettings(agentType: string): string {
  switch (agentType) {
    // Goose settings are YAML — an empty string means "no extra settings"
    // (a JSON `{}` would be skipped agent-side but reads as the wrong dialect).
    case 'goose':
      return ''
    default:
      return JSON.stringify(AGENT_SETTINGS_DEFAULTS[agentType] ?? {}, null, 2)
  }
}

export const INITIAL_CONFIG_VALUES: ConfigFormValues = {
  agent_type: 'claude-code',
  provider_id: '',
  model: '',
  small_model: '',
  prompt_id: '',
  // Start with no MCP servers pre-baked. The platform ("tos-platform") server
  // is a `required` catalog entry, so the MCP editor force-enables it and
  // writes its URL from the backend catalog (prefix-aware) — hardcoding the
  // host here would bake a non-default-APP_PREFIX-incompatible `nap-cp` URL
  // into the web bundle, which can't be overridden at runtime.
  mcp_config: JSON.stringify({ mcpServers: {} }),
  agent_settings: defaultAgentSettings('claude-code'),
  compute_resources: { ...DEFAULTS },
  skill_ids: [],
  commands: [],
  schedules: [],
  layout_id: null,
}

// ─── ConfigFormFields component ────────────────────────────────────

const SECTIONS: AgentConfigSection[] = ['model', 'prompt', 'skills', 'mcp', 'settings', 'resources']

function findScrollParent(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement
  while (parent) {
    const { overflow, overflowY } = getComputedStyle(parent)
    if (
      overflow === 'auto' ||
      overflow === 'scroll' ||
      overflowY === 'auto' ||
      overflowY === 'scroll'
    ) {
      return parent
    }
    parent = parent.parentElement
  }
  return null
}

interface ConfigFormFieldsProps {
  values: ConfigFormValues
  onChange: (values: ConfigFormValues) => void
  disabled?: boolean
  /** Hide fields that are not relevant (e.g. hide MCP/agent_settings for simpler forms) */
  compact?: boolean
  /** Called with the list of currently visible sections (for scroll-synced docs). */
  onVisibleSections?: (sections: AgentConfigSection[]) => void
  /** Template editor only: show command/schedule list editors. */
  showAutomation?: boolean
}

export function ConfigFormFields({
  values,
  onChange,
  disabled,
  compact,
  onVisibleSections,
  showAutomation,
}: ConfigFormFieldsProps) {
  const { t } = useTranslation()
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const markerRefs = useRef<Map<AgentConfigSection, HTMLDivElement>>(new Map())
  const prevVisibleRef = useRef('')

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || !onVisibleSections) return
    const container = findScrollParent(wrapper)
    if (!container) return

    const sections = compact ? SECTIONS.filter((s) => s !== 'mcp' && s !== 'settings') : SECTIONS

    let raf = 0
    function handleScroll() {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const rect = container!.getBoundingClientRect()
        const containerH = rect.height
        const minPx = containerH * 0.2
        const visible: AgentConfigSection[] = []

        for (let i = 0; i < sections.length; i++) {
          const marker = markerRefs.current.get(sections[i])
          if (!marker) continue
          const markerTop = marker.getBoundingClientRect().top
          const nextMarker =
            i + 1 < sections.length ? markerRefs.current.get(sections[i + 1]) : null
          const sectionEnd = nextMarker
            ? nextMarker.getBoundingClientRect().top
            : Number.POSITIVE_INFINITY

          // Visible portion within container viewport
          const visibleTop = Math.max(markerTop, rect.top)
          const visibleBottom = Math.min(sectionEnd, rect.bottom)
          const visiblePx = visibleBottom - visibleTop

          if (visiblePx >= minPx) {
            visible.push(sections[i])
          }
        }

        // Only notify if changed (avoid unnecessary re-renders)
        const key = visible.join(',')
        if (key !== prevVisibleRef.current) {
          prevVisibleRef.current = key
          onVisibleSections!(visible.length > 0 ? visible : ['model'])
        }
      })
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [onVisibleSections, compact])

  function update(patch: Partial<ConfigFormValues>) {
    onChange({ ...values, ...patch })
  }

  function sectionRef(section: AgentConfigSection) {
    return (el: HTMLDivElement | null) => {
      if (el) markerRefs.current.set(section, el)
      else markerRefs.current.delete(section)
    }
  }

  return (
    <div ref={wrapperRef} className={cn('space-y-3', disabled && 'pointer-events-none opacity-60')}>
      <div ref={sectionRef('model')} />
      <ModelFields
        agentType={values.agent_type}
        providerId={values.provider_id}
        model={values.model}
        smallModel={values.small_model}
        onChange={(patch) => {
          const mapped: Partial<ConfigFormValues> = {}
          if (patch.agentType !== undefined) {
            mapped.agent_type = patch.agentType
            mapped.agent_settings = defaultAgentSettings(patch.agentType)
          }
          if (patch.providerId !== undefined) mapped.provider_id = patch.providerId
          if (patch.model !== undefined) mapped.model = patch.model
          if (patch.smallModel !== undefined) mapped.small_model = patch.smallModel
          update(mapped)
        }}
      />

      {/* System Prompt from library */}
      <div ref={sectionRef('prompt')}>
        <PromptField
          label={t('components.configFormFields.labels.systemPrompt')}
          promptId={values.prompt_id || null}
          content=""
          onChange={(patch) => update({ prompt_id: patch.promptId ?? '' })}
          allowNone
          allowCustom={false}
          previewMaxHeight="15vh"
        />
      </div>

      {/* Skills */}
      <div ref={sectionRef('skills')} className="space-y-1">
        <Label className="text-xs">{t('components.configFormFields.labels.skills')}</Label>
        <SkillPicker value={values.skill_ids} onChange={(ids) => update({ skill_ids: ids })} />
      </div>

      {/* MCP Config + Agent Settings (hidden in compact mode) */}
      {!compact && (
        <>
          <div ref={sectionRef('mcp')} className="space-y-1">
            <Label className="text-xs">{t('components.configFormFields.labels.mcpConfig')}</Label>
            <McpConfigEditor
              value={values.mcp_config}
              onChange={(v) => update({ mcp_config: v })}
            />
          </div>
          <div ref={sectionRef('settings')} className="space-y-1">
            <Label className="text-xs">
              {t('components.configFormFields.labels.agentSettings')}
            </Label>
            <AgentSettingsEditor
              value={values.agent_settings}
              onChange={(v) => update({ agent_settings: v })}
              agentType={values.agent_type}
            />
          </div>
        </>
      )}

      {/* Compute Resources */}
      <div ref={sectionRef('resources')} className="space-y-1">
        <Label className="text-xs">
          {t('components.configFormFields.labels.computeResources')}
        </Label>
        <div className="rounded-lg border border-border p-3">
          <ResourceFields
            resources={values.compute_resources}
            onChange={(field, value) =>
              update({ compute_resources: { ...values.compute_resources, [field]: value } })
            }
            onPreset={(v) => update({ compute_resources: { ...v } })}
            hint={null}
          />
        </div>
      </div>

      {/* Template-distributable automation (template editor only) */}
      {showAutomation && (
        <>
          <div className="space-y-1">
            <Label className="text-xs">{t('components.automation.sections.commands')}</Label>
            <CommandsField value={values.commands} onChange={(commands) => update({ commands })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('components.automation.sections.schedules')}</Label>
            <SchedulesField
              value={values.schedules}
              onChange={(schedules) => update({ schedules })}
            />
          </div>
        </>
      )}
    </div>
  )
}
