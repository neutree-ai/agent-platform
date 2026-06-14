import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Markdown } from '@/components/ui/markdown'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { DEFAULTS } from '@/components/workspace/ConfigResourcesButton'
import { DeleteWorkspaceDialog } from '@/components/workspace/DeleteWorkspaceDialog'
import { SaveAsTemplateDialog } from '@/components/workspace/SaveAsTemplateDialog'
import {
  type ConsentSchedule,
  ScheduleConsentDialog,
} from '@/components/workspace/ScheduleConsentList'
import { McpSection } from '@/components/workspace/agent-config/McpSection'
import { ModelSection } from '@/components/workspace/agent-config/ModelSection'
import { PromptSection } from '@/components/workspace/agent-config/PromptSection'
import { ResourcesSection } from '@/components/workspace/agent-config/ResourcesSection'
import { SettingsSection } from '@/components/workspace/agent-config/SettingsSection'
import { SkillsSection } from '@/components/workspace/agent-config/SkillsSection'
import { getAgentConfigDoc } from '@/docs/inline-help/agent-config-docs'
import { getWorkspaceSettingsDoc } from '@/docs/inline-help/misc-docs'
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace'
import { useSetWorkspaceTags, useTags } from '@/hooks/useTags'
import { useWorkspaceConfig } from '@/hooks/useWorkspaceConfig'
import {
  usePatchWorkspace,
  useRebuildWorkspace,
  useRestartWorkspace,
  useStartWorkspace,
  useStopWorkspace,
  useWorkspaceStatus,
} from '@/hooks/useWorkspaces'
import { api } from '@/lib/api/client'
import type {
  ApiTemplateVersion,
  ApiWorkspaceConfig,
  ComputeResources,
  Workspace,
} from '@/lib/api/types'
import { getTagColor } from '@/lib/tag-colors'
import { cn } from '@/lib/utils'
import { workspaceConfigRefresh } from '@/plugins/builder-mode'
import { skillsRefresh } from '@/plugins/skills'
import { useInstancePersistentState, useInstanceState } from '@/stores/instance-state-store'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowUpCircle,
  BookCopy,
  Box,
  Check,
  Copy,
  Cpu,
  FileText,
  Play,
  RotateCw,
  Settings as SettingsIcon,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Wrench,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

// ─── Types ────────────────────────────────────────────────────────

type SectionKey = 'general' | 'model' | 'prompt' | 'mcp' | 'skills' | 'resources' | 'settings'

interface NavItem {
  key: SectionKey
  label: string
  icon: typeof Box
}

interface ConfigDraft {
  agentType: string
  providerId: string
  model: string
  smallModel: string
  promptId: string | null
  systemPrompt: string
  mcpConfig: string
  agentSettings: string
  computeResources: Required<ComputeResources>
  autoStart: boolean
  enabledSkills: Set<string>
}

interface GeneralDraft {
  name: string
  slug: string
  visibility: string
}

function withDefaults(r: ComputeResources | undefined | null): Required<ComputeResources> {
  return { ...DEFAULTS, ...(r ?? {}) }
}

// ─── General section ──────────────────────────────────────────────

function GeneralSection({
  workspace,
  draft,
  onChange,
  onConfigReload,
}: {
  workspace: Workspace
  draft: GeneralDraft
  onChange: (patch: Partial<GeneralDraft>) => void
  onConfigReload: () => void
}) {
  const { t } = useTranslation()
  const { data: tags } = useTags()
  const setWorkspaceTags = useSetWorkspaceTags()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [saveAsTemplateOpen, setSaveAsTemplateOpen] = useState(false)
  const [idCopied, setIdCopied] = useState(false)

  const copyId = async () => {
    await navigator.clipboard.writeText(workspace.id)
    setIdCopied(true)
    setTimeout(() => setIdCopied(false), 1500)
    toast.success(t('components.workspaceActions.toasts.idCopied'))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">
          {t('components.workspaceSettings.fields.name')}
        </Label>
        <Input
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">
          {t('components.workspaceSettings.fields.slug')}
        </Label>
        <Input
          value={draft.slug}
          onChange={(e) =>
            onChange({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })
          }
          placeholder={t('components.workspaceSettings.placeholders.slug')}
          className="text-sm font-mono"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">
          {t('components.workspaceSettings.fields.visibility')}
        </Label>
        <Select value={draft.visibility} onValueChange={(v) => onChange({ visibility: v })}>
          <SelectTrigger className="text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="private">
              {t('components.workspaceSettings.visibility.private')}
            </SelectItem>
            <SelectItem value="user">
              {t('components.workspaceSettings.visibility.user')}
            </SelectItem>
            <SelectItem value="public">
              {t('components.workspaceSettings.visibility.public')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      {tags && tags.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {t('components.workspaceSettings.fields.tags')}
            {setWorkspaceTags.isPending && <Spinner size="sm" className="h-3 w-3" />}
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const color = getTagColor(tag.color)
              const checked = workspace.tag_ids?.includes(tag.id) ?? false
              return (
                <button
                  key={tag.id}
                  type="button"
                  disabled={setWorkspaceTags.isPending}
                  onClick={() => {
                    const newIds = checked
                      ? (workspace.tag_ids || []).filter((id) => id !== tag.id)
                      : [...(workspace.tag_ids || []), tag.id]
                    setWorkspaceTags.mutate({ workspaceId: workspace.id, tagIds: newIds })
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-colors',
                    checked
                      ? cn(color.bg, 'border-transparent text-white')
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      checked ? 'bg-current opacity-50' : color.bg,
                    )}
                  />
                  {tag.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Save as template */}
      <div className="mt-4 flex items-start justify-between gap-3 border-t border-border/60 pt-4">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">
            {t('components.workspaceActions.actions.saveAsTemplate')}
          </div>
          <p className="mt-1 text-mini text-muted-foreground">
            {t('components.settings.saveAsTemplate.description')}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
          onClick={() => setSaveAsTemplateOpen(true)}
        >
          <BookCopy className="h-3 w-3" strokeWidth={2} />
          {t('components.settings.saveAsTemplate.action')}
        </Button>
      </div>
      <SaveAsTemplateDialog
        workspace={workspace}
        open={saveAsTemplateOpen}
        onOpenChange={setSaveAsTemplateOpen}
        onSaved={onConfigReload}
      />

      {/* Workspace ID — debug-class, kept at bottom but styled as a regular field */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">
          {t('components.settings.fields.id')}
        </Label>
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {workspace.id}
          </code>
          <button
            type="button"
            onClick={copyId}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
          >
            {idCopied ? (
              <Check className="h-3 w-3 text-success" strokeWidth={2} />
            ) : (
              <Copy className="h-3 w-3" strokeWidth={2} />
            )}
          </button>
        </div>
      </div>

      {/* Danger zone — inline at the bottom of General */}
      <div className="mt-4 border-t border-border/60 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              {t('components.deleteWorkspace.title')}
            </div>
            <p className="mt-1 text-mini text-muted-foreground">
              {t('components.deleteWorkspace.description.prefix')}
              <span className="font-medium text-foreground">{workspace.name}</span>
              {t('components.deleteWorkspace.description.suffix')}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1.5 border-destructive/40 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-3 w-3" strokeWidth={2} />
            {t('components.deleteWorkspace.actions.delete')}
          </Button>
        </div>
      </div>

      <DeleteWorkspaceDialog workspace={workspace} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────

/**
 * "vN available" upgrade affordance. If the target version introduces schedules
 * the workspace doesn't already have, prompt the recipient to consent (which
 * ones to auto-enable) before syncing; otherwise sync straight through.
 */
function TemplateUpgradeButton({
  workspaceId,
  templateId,
  latestVersion,
  onUpgraded,
}: {
  workspaceId: string
  templateId: string
  latestVersion: number
  onUpgraded: () => void
}) {
  const { t } = useTranslation()
  const [syncing, setSyncing] = useState(false)
  const [consentOpen, setConsentOpen] = useState(false)
  const [consentSchedules, setConsentSchedules] = useState<ConsentSchedule[]>([])

  async function doSync(scheduleOverrides?: Record<string, boolean>) {
    setSyncing(true)
    try {
      await api.syncTemplate(workspaceId, scheduleOverrides)
      toast.success(t('components.agentConfigDialog.toasts.upgraded', { version: latestVersion }))
      setConsentOpen(false)
      onUpgraded()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('components.agentConfigDialog.errors.syncFailed'),
      )
    } finally {
      setSyncing(false)
    }
  }

  async function prepare() {
    setSyncing(true)
    try {
      const version = await api.getTemplateVersion(templateId, latestVersion)
      const versionSchedules = version.schedules ?? []
      if (versionSchedules.length === 0) {
        await doSync()
        return
      }
      // Only the schedules the workspace doesn't already carry need consent;
      // existing ones keep the user's current toggle (reconciled server-side).
      const existing = await api.listSchedules(workspaceId)
      const have = new Set(existing.filter((s) => s.origin === 'template').map((s) => s.name))
      const fresh = versionSchedules.filter((s) => !have.has(s.name))
      if (fresh.length === 0) {
        await doSync()
        return
      }
      setConsentSchedules(fresh)
      setConsentOpen(true)
      setSyncing(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('components.agentConfigDialog.errors.syncFailed'),
      )
      setSyncing(false)
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={syncing}
        className="inline-flex shrink-0 items-center gap-1 text-primary hover:text-primary/80 disabled:opacity-50"
        onClick={prepare}
      >
        <ArrowUpCircle className="h-3 w-3" strokeWidth={2} />
        {syncing
          ? t('components.agentConfigDialog.template.upgrading')
          : t('components.agentConfigDialog.template.available', { version: latestVersion })}
      </button>
      <ScheduleConsentDialog
        open={consentOpen}
        onOpenChange={setConsentOpen}
        schedules={consentSchedules}
        confirming={syncing}
        onConfirm={doSync}
      />
    </>
  )
}

interface WorkspaceSettingsPanelProps {
  workspaceId: string
  instanceId: string
}

export function WorkspaceSettingsPanel({ workspaceId, instanceId }: WorkspaceSettingsPanelProps) {
  const { t } = useTranslation()
  const headerSlot = useAppHeaderSlot()
  const workspace = useCurrentWorkspace()
  const { config, isLoading: configLoading, updateFields, reload } = useWorkspaceConfig(workspaceId)

  // Agent-driven auto-refresh: builder-mode plugin bumps when
  // workspace_config_apply or workspace_prompt_apply completes. Both touch
  // workspace_config; config_apply also touches workspaces (name/slug/visibility).
  const configToken = workspaceConfigRefresh.useToken()
  const qc = useQueryClient()
  // Tracks the config object reference at the moment of the latest token bump.
  // When react-query swaps in a fresh config (different ref), the re-seed
  // effect below fires once and resets this back to null.
  const pendingReseedConfigRef = useRef<ApiWorkspaceConfig | null>(null)
  const pendingReseedGeneralRef = useRef<Workspace | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires only on token change
  useEffect(() => {
    if (configToken === 0) return
    pendingReseedConfigRef.current = config
    reload()
    pendingReseedGeneralRef.current = workspace ?? null
    qc.invalidateQueries({ queryKey: ['workspaces'] })
  }, [configToken])

  // Re-seed the draft from fresh config after an agent-driven bump. We wait
  // for react-query to swap in a new config reference (post-invalidation
  // refetch) before mirroring the init effect's setDraft. Skills are handled
  // separately by the skillsToken effect, so we leave enabledSkills untouched.
  useEffect(() => {
    if (!config) return
    if (pendingReseedConfigRef.current === null) return
    if (pendingReseedConfigRef.current === config) return
    pendingReseedConfigRef.current = null
    setDraft((d) => ({
      ...d,
      agentType: config.agent_type || 'claude-code',
      providerId: config.provider_id || '',
      model: config.model,
      smallModel: config.small_model,
      promptId: config.prompt_id,
      systemPrompt: config.prompt_id ? (config.prompt_content ?? '') : config.system_prompt,
      mcpConfig: config.mcp_config,
      agentSettings: config.agent_settings,
      computeResources: withDefaults(config.compute_resources),
      autoStart: config.auto_start ?? true,
    }))
    if (config.template_id && config.template_version) {
      api
        .getTemplateVersion(config.template_id, config.template_version)
        .then(setTemplateConfig)
        .catch(() => setTemplateConfig(null))
    } else {
      setTemplateConfig(null)
    }
  }, [config])

  // biome-ignore lint/correctness/useExhaustiveDependencies: fires only when workspace ref swaps after a config bump
  useEffect(() => {
    const pending = pendingReseedGeneralRef.current
    if (!pending || !workspace || workspace === pending) return
    pendingReseedGeneralRef.current = null
    setGeneral({
      name: workspace.name ?? '',
      slug: workspace.slug ?? '',
      visibility: workspace.visibility ?? 'private',
    })
  }, [workspace])

  // Skills are fetched imperatively below (no react-query), so we need to
  // re-pull when the skills plugin bumps — covers builder-mode
  // workspace_skill_(enable|disable)_apply as well as the original
  // skill_create_draft/edit/publish lifecycle.
  const workspaceSkillsToken = skillsRefresh.useToken()

  const patchWs = usePatchWorkspace()
  const startMutation = useStartWorkspace()
  const stopMutation = useStopWorkspace()
  const restartMutation = useRestartWorkspace()
  const rebuildMutation = useRebuildWorkspace()
  const [rebuildConfirmOpen, setRebuildConfirmOpen] = useState(false)
  const isRunning = workspace?.status === 'running' || workspace?.status === 'starting'
  const lifecyclePending =
    startMutation.isPending || stopMutation.isPending || restartMutation.isPending

  // Poll K8s status while the workspace is mid-transition (to surface
  // FailedScheduling / image pull / OOM reasons behind a stuck 'starting')
  // and while running (to detect template drift → "update available").
  const { data: k8sStatus } = useWorkspaceStatus(workspaceId, {
    enabled: workspace?.status === 'starting' || workspace?.status === 'running',
  })
  const startupWarnings = k8sStatus?.warnings ?? []
  const startupFailedConditions = (k8sStatus?.conditions ?? []).filter(
    (c) => !c.status && c.message,
  )
  const showStartupAlert =
    workspace?.status === 'starting' &&
    (startupWarnings.length > 0 || startupFailedConditions.length > 0)
  // Runtime is behind the current platform template — offer a rebuild.
  const updateAvailable = (k8sStatus?.rebuild?.available ?? false) && !lifecyclePending

  async function handleRebuild() {
    try {
      const res = await rebuildMutation.mutateAsync(workspaceId)
      toast.success(
        res.rebuilt
          ? t('components.settings.rebuild.toasts.started')
          : t('components.settings.rebuild.toasts.upToDate'),
      )
    } finally {
      setRebuildConfirmOpen(false)
    }
  }

  // Persisted: which settings nav page is showing — "where am I".
  const [activeSection, setActiveSection] = useInstancePersistentState<SectionKey>(
    instanceId,
    'activeSection',
    () => 'general',
  )

  // Agent config draft — user input mid-flow. Survives layout switch via
  // instance state, but lost on refresh (re-fetched from server).
  const [draft, setDraft] = useInstanceState<ConfigDraft>(instanceId, 'draft', () => ({
    agentType: 'claude-code',
    providerId: '',
    model: '',
    smallModel: '',
    promptId: null,
    systemPrompt: '',
    mcpConfig: '{}',
    agentSettings: '{}',
    computeResources: { ...DEFAULTS },
    autoStart: true,
    enabledSkills: new Set(),
  }))
  // Revert intent is transient — it only matters between "user clicked
  // Revert" and "user clicked Save". Persisting across panel reopens is a
  // footgun: a stale `compute_resources` revert mark would hijack the next
  // save and silently overwrite the user's L preset with {}, even if they
  // never clicked Revert in this session. Use plain useState so it resets
  // when the settings panel unmounts.
  const [revertedFields, setRevertedFields] = useState<Set<string>>(() => new Set())
  const [presetConfirm, setPresetConfirm] = useState<Required<ComputeResources> | null>(null)
  const [templateConfig, setTemplateConfig] = useInstanceState<ApiTemplateVersion | null>(
    instanceId,
    'templateConfig',
    () => null,
  )
  // originalSkills tracks server-side baseline for dirty detection. Lives
  // alongside the draft (in-memory), so it survives layout switch and stays
  // consistent with whatever draft snapshot is in memory.
  const [originalSkills, setOriginalSkills] = useInstanceState<Set<string>>(
    instanceId,
    'originalSkills',
    () => new Set(),
  )
  const [configInitialized, setConfigInitialized] = useInstanceState<boolean>(
    instanceId,
    'configInitialized',
    () => false,
  )

  // Init config draft when config loads
  useEffect(() => {
    if (!config || configInitialized) return
    setConfigInitialized(true)
    setDraft({
      agentType: config.agent_type || 'claude-code',
      providerId: config.provider_id || '',
      model: config.model,
      smallModel: config.small_model,
      promptId: config.prompt_id,
      systemPrompt: config.prompt_id ? (config.prompt_content ?? '') : config.system_prompt,
      mcpConfig: config.mcp_config,
      agentSettings: config.agent_settings,
      computeResources: withDefaults(config.compute_resources),
      autoStart: config.auto_start ?? true,
      enabledSkills: new Set(),
    })
    api
      .getWorkspaceSkillIds(workspaceId)
      .then((names) => {
        const set = new Set(names)
        setOriginalSkills(set)
        setDraft((d) => ({ ...d, enabledSkills: new Set(set) }))
      })
      .catch(() => {})
    if (config.template_id && config.template_version) {
      api
        .getTemplateVersion(config.template_id, config.template_version)
        .then(setTemplateConfig)
        .catch(() => setTemplateConfig(null))
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: init-once guard via configInitialized flag
  }, [config, workspaceId, configInitialized])

  // Re-pull workspace skills when the skills plugin bumps. Keeps the draft
  // checkbox state in sync with whatever the agent just attached/detached;
  // any unsaved manual skill edits get clobbered, which matches the policy
  // we already accept for other agent-driven config refreshes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires only on token change
  useEffect(() => {
    if (workspaceSkillsToken === 0) return
    api
      .getWorkspaceSkillIds(workspaceId)
      .then((names) => {
        const set = new Set(names)
        setOriginalSkills(set)
        setDraft((d) => ({ ...d, enabledSkills: new Set(set) }))
      })
      .catch(() => {})
  }, [workspaceSkillsToken])

  // General draft — same in-memory rule as ConfigDraft.
  const [general, setGeneral] = useInstanceState<GeneralDraft>(instanceId, 'general', () => ({
    name: '',
    slug: '',
    visibility: 'private',
  }))
  const [generalInitialized, setGeneralInitialized] = useInstanceState<boolean>(
    instanceId,
    'generalInitialized',
    () => false,
  )
  useEffect(() => {
    if (!workspace || generalInitialized) return
    setGeneralInitialized(true)
    setGeneral({
      name: workspace.name,
      slug: workspace.slug || '',
      visibility: workspace.visibility || 'private',
    })
    // biome-ignore lint/correctness/useExhaustiveDependencies: init-once guard via generalInitialized flag
  }, [workspace, generalInitialized])

  // Maps a ConfigDraft field name to the corresponding `revertedFields`
  // key used in the save patch logic. Used to clear a stale revert mark
  // when the user explicitly edits a field — without this, clicking
  // Revert and then picking a preset still sends `{}` to the backend.
  const DRAFT_TO_REVERT_KEY: Partial<Record<keyof ConfigDraft, string>> = {
    agentType: 'agent_type',
    providerId: 'provider_id',
    model: 'model',
    smallModel: 'small_model',
    promptId: 'prompt_id',
    systemPrompt: 'prompt_id',
    mcpConfig: 'mcp_config',
    agentSettings: 'agent_settings',
    computeResources: 'compute_resources',
  }

  function patchDraft(patch: Partial<ConfigDraft>, revertFields?: string[]) {
    setDraft((d) => ({ ...d, ...patch }))
    if (revertFields) {
      setRevertedFields((prev) => {
        const next = new Set(prev)
        for (const f of revertFields) next.add(f)
        return next
      })
      return
    }
    // Explicit edit: clear any prior revert intent on the touched fields.
    const toUnrevert = new Set<string>()
    for (const k of Object.keys(patch) as (keyof ConfigDraft)[]) {
      const revertKey = DRAFT_TO_REVERT_KEY[k]
      if (revertKey) toUnrevert.add(revertKey)
    }
    if (toUnrevert.size === 0) return
    setRevertedFields((prev) => {
      if (!prev.size) return prev
      const next = new Set(prev)
      let changed = false
      for (const f of toUnrevert) {
        if (next.delete(f)) changed = true
      }
      return changed ? next : prev
    })
  }

  function toggleSkill(id: string) {
    setDraft((d) => {
      const next = new Set(d.enabledSkills)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...d, enabledSkills: next }
    })
  }

  // Dirty tracking
  const configDirty = useMemo(() => {
    if (!config) return false
    if (revertedFields.size > 0) return true
    if (draft.agentType !== (config.agent_type || 'claude-code')) return true
    if ((draft.providerId || null) !== (config.provider_id || null)) return true
    if (draft.model !== config.model) return true
    if (draft.smallModel !== config.small_model) return true
    if (draft.promptId !== config.prompt_id) return true
    if (
      draft.systemPrompt !==
      (config.prompt_id ? (config.prompt_content ?? '') : config.system_prompt)
    )
      return true
    if (draft.mcpConfig !== config.mcp_config) return true
    if (draft.agentSettings !== config.agent_settings) return true
    if (
      JSON.stringify(draft.computeResources) !==
      JSON.stringify(withDefaults(config.compute_resources))
    )
      return true
    if (draft.autoStart !== (config.auto_start ?? true)) return true
    const orig = originalSkills
    if (
      draft.enabledSkills.size !== orig.size ||
      [...draft.enabledSkills].some((s) => !orig.has(s))
    )
      return true
    return false
  }, [config, draft, revertedFields, originalSkills])

  const generalDirty = useMemo(() => {
    if (!workspace) return false
    if (general.name.trim() !== workspace.name) return true
    if ((general.slug.trim() || null) !== (workspace.slug || null)) return true
    if (general.visibility !== (workspace.visibility || 'private')) return true
    return false
  }, [workspace, general])

  const isDirty = configDirty || generalDirty
  const [isSaving, setIsSaving] = useState(false)

  async function handleSave() {
    if (!isDirty || isSaving || !config || !workspace) return
    setIsSaving(true)
    try {
      // ─ Agent config patch ─
      if (configDirty) {
        const patch: Partial<ApiWorkspaceConfig> = {}
        if (revertedFields.has('agent_type')) patch.agent_type = ''
        else if (draft.agentType !== config.agent_type) patch.agent_type = draft.agentType
        if (revertedFields.has('provider_id')) patch.provider_id = null
        else {
          const v = draft.providerId || null
          if (v !== (config.provider_id || null)) patch.provider_id = v
        }
        if (revertedFields.has('model')) patch.model = ''
        else if (draft.model !== config.model) patch.model = draft.model
        if (revertedFields.has('small_model')) patch.small_model = ''
        else if (draft.smallModel !== config.small_model) patch.small_model = draft.smallModel
        if (revertedFields.has('prompt_id')) {
          patch.prompt_id = null
          patch.system_prompt = ''
        } else {
          if (draft.promptId !== config.prompt_id) patch.prompt_id = draft.promptId
          if (draft.systemPrompt !== config.system_prompt) patch.system_prompt = draft.systemPrompt
        }
        if (revertedFields.has('mcp_config')) patch.mcp_config = '{}'
        else if (draft.mcpConfig !== config.mcp_config) patch.mcp_config = draft.mcpConfig
        if (revertedFields.has('agent_settings')) patch.agent_settings = '{}'
        else if (draft.agentSettings !== config.agent_settings)
          patch.agent_settings = draft.agentSettings
        if (revertedFields.has('compute_resources'))
          patch.compute_resources = {} as ComputeResources
        else if (
          JSON.stringify(draft.computeResources) !==
          JSON.stringify(withDefaults(config.compute_resources))
        )
          patch.compute_resources = draft.computeResources

        if (draft.autoStart !== (config.auto_start ?? true)) patch.auto_start = draft.autoStart

        if (Object.keys(patch).length > 0) {
          await updateFields(patch)
        }

        const orig = originalSkills
        const skillsChanged =
          draft.enabledSkills.size !== orig.size ||
          [...draft.enabledSkills].some((s) => !orig.has(s))
        if (skillsChanged) {
          await api.updateWorkspaceSkills(workspaceId, [...draft.enabledSkills])
          setOriginalSkills(new Set(draft.enabledSkills))
        }

        setRevertedFields(new Set())
      }

      // ─ Workspace patch ─
      if (generalDirty) {
        const patch: Record<string, unknown> = {}
        if (general.name.trim() !== workspace.name) patch.name = general.name.trim()
        const newSlug = general.slug.trim() || null
        if (newSlug !== (workspace.slug || null)) patch.slug = newSlug
        if (general.visibility !== (workspace.visibility || 'private'))
          patch.visibility = general.visibility
        if (Object.keys(patch).length > 0) {
          await patchWs.mutateAsync({ id: workspace.id, ...patch })
        }
      }

      toast.success(t('components.agentConfigDialog.toasts.saved'))
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('components.agentConfigDialog.errors.saveFailed'),
      )
    } finally {
      setIsSaving(false)
    }
  }

  // Template-aware revert helpers
  const tplModel = templateConfig
    ? {
        agent_type: templateConfig.agent_type,
        provider_id: templateConfig.provider_id,
        model: templateConfig.model,
        small_model: templateConfig.small_model,
      }
    : null
  const tplPrompt = templateConfig
    ? {
        prompt_id: templateConfig.prompt_id,
        system_prompt: templateConfig.system_prompt,
        prompt_name: null as string | null,
        prompt_content: null as string | null,
      }
    : null
  const tplMcp = templateConfig
    ? {
        mcp_config:
          typeof templateConfig.mcp_config === 'string'
            ? templateConfig.mcp_config
            : JSON.stringify(templateConfig.mcp_config),
      }
    : null
  const tplSettings = templateConfig
    ? {
        agent_settings:
          typeof templateConfig.agent_settings === 'string'
            ? templateConfig.agent_settings
            : JSON.stringify(templateConfig.agent_settings),
      }
    : null
  // p3: SkillsSection now compares by UUID. Templates carry both `skill_ids`
  // (authoritative) and `skill_names` (display denormalized) per version.
  const tplSkills = templateConfig ? { skill_ids: templateConfig.skill_ids } : null
  const tplResources = templateConfig
    ? { compute_resources: templateConfig.compute_resources as ComputeResources }
    : null

  const navItems: NavItem[] = useMemo(
    () => [
      { key: 'general', label: t('components.settings.nav.general'), icon: SettingsIcon },
      { key: 'model', label: t('components.settings.nav.model'), icon: Box },
      { key: 'prompt', label: t('components.settings.nav.prompt'), icon: FileText },
      { key: 'mcp', label: t('components.settings.nav.mcp'), icon: Wrench },
      { key: 'skills', label: t('components.settings.nav.skills'), icon: Sparkles },
      { key: 'resources', label: t('components.settings.nav.resources'), icon: Cpu },
      { key: 'settings', label: t('components.settings.nav.settings'), icon: Sliders },
    ],
    [t],
  )

  function renderSection(): ReactNode {
    if (!config) return null
    switch (activeSection) {
      case 'model':
        return (
          <ModelSection
            agentType={draft.agentType}
            providerId={draft.providerId}
            model={draft.model}
            smallModel={draft.smallModel}
            originalAgentType={config.agent_type || 'claude-code'}
            onChange={(patch) =>
              patchDraft({
                ...(patch.agentType !== undefined ? { agentType: patch.agentType } : {}),
                ...(patch.providerId !== undefined ? { providerId: patch.providerId } : {}),
                ...(patch.model !== undefined ? { model: patch.model } : {}),
                ...(patch.smallModel !== undefined ? { smallModel: patch.smallModel } : {}),
              })
            }
            onRevert={(fields) =>
              patchDraft(
                {
                  ...(fields.includes('agent_type')
                    ? { agentType: tplModel?.agent_type || 'claude-code' }
                    : {}),
                  ...(fields.includes('provider_id')
                    ? { providerId: tplModel?.provider_id || '' }
                    : {}),
                  ...(fields.includes('model') ? { model: tplModel?.model || '' } : {}),
                  ...(fields.includes('small_model')
                    ? { smallModel: tplModel?.small_model || '' }
                    : {}),
                },
                fields,
              )
            }
            templateConfig={tplModel}
          />
        )
      case 'prompt':
        return (
          <PromptSection
            promptId={draft.promptId}
            systemPrompt={draft.systemPrompt}
            promptName={config.prompt_name}
            promptContent={config.prompt_content}
            onChange={(patch) =>
              patchDraft({
                ...(patch.promptId !== undefined ? { promptId: patch.promptId } : {}),
                ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
              })
            }
            onRevert={() =>
              patchDraft(
                {
                  promptId: tplPrompt?.prompt_id ?? null,
                  systemPrompt: tplPrompt?.system_prompt || '',
                },
                ['prompt_id'],
              )
            }
            templateConfig={tplPrompt}
          />
        )
      case 'mcp':
        return (
          <McpSection
            mcpConfig={draft.mcpConfig}
            onChange={(v) => patchDraft({ mcpConfig: v })}
            onRevert={() => {
              const tplVal = tplMcp?.mcp_config || '{}'
              patchDraft({ mcpConfig: tplVal }, ['mcp_config'])
            }}
            templateConfig={tplMcp}
            workspaceId={workspaceId}
          />
        )
      case 'settings':
        return (
          <SettingsSection
            agentSettings={draft.agentSettings}
            onChange={(v) => patchDraft({ agentSettings: v })}
            agentType={draft.agentType}
            onRevert={() => {
              const tplVal =
                tplSettings?.agent_settings || (draft.agentType === 'codex' ? '' : '{}')
              patchDraft({ agentSettings: tplVal }, ['agent_settings'])
            }}
            templateConfig={tplSettings}
          />
        )
      case 'skills':
        return (
          <SkillsSection
            workspaceId={workspaceId}
            enabledSkills={draft.enabledSkills}
            onToggle={toggleSkill}
            templateConfig={tplSkills}
          />
        )
      case 'resources':
        return (
          <ResourcesSection
            resources={draft.computeResources}
            onChange={(field, value) =>
              patchDraft({ computeResources: { ...draft.computeResources, [field]: value } })
            }
            onPreset={(values) => {
              const current = config?.compute_resources
                ? withDefaults(config.compute_resources)
                : null
              const sameAsApplied =
                !!current &&
                current.cpu_request === values.cpu_request &&
                current.cpu_limit === values.cpu_limit &&
                current.memory_request === values.memory_request &&
                current.memory_limit === values.memory_limit &&
                current.storage === values.storage
              if (isRunning && !sameAsApplied) {
                setPresetConfirm(values)
                return
              }
              patchDraft({ computeResources: { ...values } })
            }}
            onRevert={() => {
              const tplVal = withDefaults(tplResources?.compute_resources)
              patchDraft({ computeResources: { ...tplVal } }, ['compute_resources'])
            }}
            autoStart={draft.autoStart}
            onAutoStartChange={(v) => patchDraft({ autoStart: v })}
            templateConfig={tplResources}
          />
        )
      case 'general':
        return workspace ? (
          <GeneralSection
            workspace={workspace}
            draft={general}
            onChange={(patch) => setGeneral((g) => ({ ...g, ...patch }))}
            onConfigReload={reload}
          />
        ) : null
      default:
        return null
    }
  }

  if (!workspace || !config) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        <Spinner size="sm" className="mr-1.5" />
        {t('common.loading')}
      </div>
    )
  }

  const docsContent =
    activeSection === 'general'
      ? getWorkspaceSettingsDoc()
      : getAgentConfigDoc(activeSection as never, {
          hasTemplate: !!templateConfig,
          agentType: draft.agentType,
        })

  return (
    <div className="flex h-full min-h-0 flex-col">
      {headerSlot &&
        workspace &&
        createPortal(
          <>
            {isRunning ? (
              <AppHeaderButton
                icon={Square}
                label={t('components.workspaceActions.actions.stop')}
                onClick={() => stopMutation.mutate(workspaceId)}
                disabled={lifecyclePending}
              />
            ) : (
              <AppHeaderButton
                icon={Play}
                label={t('components.workspaceActions.actions.start')}
                onClick={() => startMutation.mutate(workspaceId)}
                disabled={lifecyclePending}
              />
            )}
            <AppHeaderButton
              icon={RotateCw}
              label={t('components.settings.lifecycle.restart')}
              onClick={() => restartMutation.mutate(workspaceId)}
              disabled={lifecyclePending || !isRunning}
            />
          </>,
          headerSlot,
        )}

      <div className="flex flex-1 min-h-0">
        {/* Left nav — single flat list */}
        <div className="flex w-36 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/60 px-2 py-3">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = activeSection === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveSection(item.key)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                  active
                    ? 'bg-foreground/[0.06] text-foreground'
                    : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </div>

        {/* Center content */}
        <ScrollArea className="min-w-0 flex-1">
          <div className="px-6 py-5">
            {updateAvailable && (
              <Alert className="mb-4">
                <ArrowUpCircle className="h-4 w-4 text-primary" strokeWidth={2} />
                <AlertTitle className="text-sm">
                  {t('components.settings.rebuild.available.title')}
                </AlertTitle>
                <AlertDescription className="mt-1.5">
                  <p className="text-xs text-muted-foreground">
                    {t('components.settings.rebuild.available.description')}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 gap-1.5 px-3 text-xs"
                    onClick={() => setRebuildConfirmOpen(true)}
                  >
                    <ArrowUpCircle className="h-3 w-3" strokeWidth={2} />
                    {t('components.settings.rebuild.available.action')}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <Dialog open={rebuildConfirmOpen} onOpenChange={setRebuildConfirmOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('components.settings.rebuild.confirm.title')}</DialogTitle>
                  <DialogDescription>
                    {t('components.settings.rebuild.confirm.description')}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRebuildConfirmOpen(false)}
                    disabled={rebuildMutation.isPending}
                  >
                    {t('components.settings.rebuild.confirm.cancel')}
                  </Button>
                  <Button size="sm" onClick={handleRebuild} disabled={rebuildMutation.isPending}>
                    {rebuildMutation.isPending
                      ? t('components.settings.rebuild.confirm.pending')
                      : t('components.settings.rebuild.confirm.confirm')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {showStartupAlert && (
              <Alert variant="destructive" className="mb-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-sm">
                  {t('components.settings.startupAlert.title')}
                </AlertTitle>
                <AlertDescription className="mt-1.5 space-y-1">
                  {startupWarnings.map((w, i) => (
                    <div key={`w-${i}`} className="text-xs">
                      <span className="font-medium">{w.reason}</span>
                      {w.message ? (
                        <span className="text-muted-foreground"> — {w.message}</span>
                      ) : null}
                    </div>
                  ))}
                  {startupFailedConditions.map((c, i) => (
                    <div key={`c-${i}`} className="text-xs">
                      <span className="font-medium">{c.type}</span>
                      <span className="text-muted-foreground"> — {c.message}</span>
                    </div>
                  ))}
                </AlertDescription>
              </Alert>
            )}
            {renderSection()}
          </div>
        </ScrollArea>

        {/* Right docs */}
        <ScrollArea className="hidden w-64 shrink-0 border-l border-border/60 lg:block">
          <div className="px-4 py-5">
            <Markdown
              key={activeSection}
              className="text-xs [&_h2]:text-sm [&_h3]:text-xs [&_p]:text-xs [&_li]:text-xs [&_code]:text-tiny [&_td]:text-xs [&_th]:text-xs"
            >
              {docsContent}
            </Markdown>
          </div>
        </ScrollArea>
      </div>

      {/* Fixed footer — shared across all sections */}
      <div className="flex h-11 shrink-0 items-center gap-3 border-t border-border/60 bg-background/60 px-4">
        {config.template_id && config.template_name && (
          <span className="inline-flex min-w-0 shrink items-center gap-1.5 text-mini text-muted-foreground">
            <span className="truncate">
              {t('components.agentConfigDialog.template.base', {
                name: config.template_name,
                version: config.template_version,
              })}
            </span>
            {config.template_latest_version != null &&
              config.template_version != null &&
              config.template_latest_version > config.template_version && (
                <TemplateUpgradeButton
                  workspaceId={workspaceId}
                  templateId={config.template_id}
                  latestVersion={config.template_latest_version}
                  onUpgraded={reload}
                />
              )}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {isDirty && (
            <span className="text-mini text-warning">
              {t('components.settings.unsavedChanges')}
            </span>
          )}
          <Button
            size="sm"
            className="h-7 gap-1.5 px-3 text-xs"
            onClick={handleSave}
            disabled={!isDirty || isSaving || configLoading}
          >
            {isSaving && <Spinner size="sm" className="h-3 w-3" />}
            {isSaving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>
      <Dialog
        open={presetConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setPresetConfirm(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('components.settings.resizeConfirm.title')}</DialogTitle>
            <DialogDescription>
              {t('components.settings.resizeConfirm.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setPresetConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (presetConfirm) {
                  patchDraft({ computeResources: { ...presetConfirm } })
                }
                setPresetConfirm(null)
              }}
            >
              {t('components.settings.resizeConfirm.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
