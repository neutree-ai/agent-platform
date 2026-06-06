import { TemplateShareDialog } from '@/components/dialogs/TemplateShareDialog'
import { TemplateConfigView } from '@/components/library/TemplateConfigView'
import { ResourceFilterTabs, type ScopeFilter } from '@/components/resource/ResourceFilterTabs'
import { ScopeBadge } from '@/components/resource/ScopeBadge'
import { MasterSidebar } from '@/components/shell/master-sidebar/MasterSidebar'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
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
import {
  ConfigFormFields,
  type ConfigFormValues,
  INITIAL_CONFIG_VALUES,
} from '@/components/workspace/ConfigFormFields'
import { DEFAULTS, RESOURCE_PRESETS } from '@/components/workspace/ConfigResourcesButton'
import { useDialogStack } from '@/contexts/DialogStackContext'
import { usePrompts, usePublicPrompts } from '@/hooks/usePrompts'
import { templatesQueryKey, useTemplates } from '@/hooks/useTemplates'
import { api } from '@/lib/api/client'
import type {
  ApiModelProvider,
  ApiPrompt,
  ApiTemplate,
  ApiTemplateVersion,
  ComputeResources,
} from '@/lib/api/types'
import { formatTemplateLinkError } from '@/lib/template-link-error'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, RotateCcw, Share2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

function versionToConfig(v: ApiTemplateVersion): ConfigFormValues {
  return {
    agent_type: v.agent_type || 'claude-code',
    provider_id: v.provider_id || '',
    model: v.model || '',
    small_model: v.small_model || '',
    prompt_id: v.prompt_id || '',
    mcp_config: v.mcp_config || '{}',
    agent_settings: v.agent_settings || '{}',
    compute_resources: { ...DEFAULTS, ...(v.compute_resources as ComputeResources) },
    skill_ids: v.skill_ids ?? [],
    commands: (v.commands ?? []).map((c) => ({
      name: c.name,
      type: c.type,
      prompt_id: c.prompt_id,
      content: c.content,
    })),
    schedules: (v.schedules ?? []).map((s) => ({
      name: s.name,
      cron: s.cron,
      timezone: s.timezone,
      prompt: s.prompt,
      prompt_id: s.prompt_id,
      enabled_default: s.enabled_default,
    })),
    layout_id: v.layout_id,
  }
}

function matchResourcePreset(r: ComputeResources): string {
  const cpuLimit = r.cpu_limit || '?'
  const memoryLimit = r.memory_limit || '?'
  for (const preset of RESOURCE_PRESETS) {
    if (preset.values.cpu_limit === r.cpu_limit && preset.values.memory_limit === r.memory_limit) {
      return `${preset.label} (${preset.description})`
    }
  }
  return `${cpuLimit} / ${memoryLimit}`
}

function getMcpServerNames(mcpConfigStr: string): string[] {
  try {
    const parsed = JSON.parse(mcpConfigStr)
    const servers = parsed?.mcpServers ?? parsed
    if (!servers || typeof servers !== 'object') return []
    return Object.keys(servers).sort()
  } catch {
    return []
  }
}

function ConfigDiff({
  oldConfig,
  newConfig,
  oldLabel,
  newLabel,
  providers,
  prompts,
}: {
  oldConfig: ConfigFormValues
  newConfig: ConfigFormValues
  oldLabel: string
  newLabel: string
  providers: ApiModelProvider[]
  prompts: ApiPrompt[]
}) {
  const { t } = useTranslation()
  const resolveProvider = (id: string) => {
    const p = providers.find((x) => x.id === id)
    return p
      ? `${p.name} (${p.provider_type})`
      : id || t('components.library.templateConfigView.empty.value')
  }
  const resolvePrompt = (id: string) => {
    const p = prompts.find((x) => x.id === id)
    return p ? p.name : id || t('components.library.templateConfigView.empty.value')
  }

  const rows: { label: string; old: string; new_: string }[] = [
    {
      label: t('components.modelFields.labels.agentType'),
      old: oldConfig.agent_type || t('components.library.templateConfigView.empty.value'),
      new_: newConfig.agent_type || t('components.library.templateConfigView.empty.value'),
    },
    {
      label: t('components.modelFields.labels.provider'),
      old: resolveProvider(oldConfig.provider_id),
      new_: resolveProvider(newConfig.provider_id),
    },
    {
      label: t('components.modelFields.labels.model'),
      old: oldConfig.model || t('components.library.templateConfigView.empty.value'),
      new_: newConfig.model || t('components.library.templateConfigView.empty.value'),
    },
    {
      label: t('components.modelFields.labels.smallModel'),
      old: oldConfig.small_model || t('components.library.templateConfigView.empty.value'),
      new_: newConfig.small_model || t('components.library.templateConfigView.empty.value'),
    },
    {
      label: t('components.library.templateConfigView.sections.prompt'),
      old: resolvePrompt(oldConfig.prompt_id),
      new_: resolvePrompt(newConfig.prompt_id),
    },
  ]

  // Skills — render names (resolved by the caller via the skill cache) when
  // available, fall back to ids. We only have ids here; the surrounding
  // TemplatesSection passes a resolver via a lookup map below.
  const oldSkills =
    (oldConfig.skill_ids ?? []).sort().join(', ') ||
    t('components.library.templateConfigView.empty.value')
  const newSkills =
    (newConfig.skill_ids ?? []).sort().join(', ') ||
    t('components.library.templateConfigView.empty.value')
  rows.push({ label: t('pages.library.navigation.skills'), old: oldSkills, new_: newSkills })

  // MCP Servers
  const oldServers =
    getMcpServerNames(oldConfig.mcp_config).join(', ') ||
    t('components.library.templateConfigView.empty.value')
  const newServers =
    getMcpServerNames(newConfig.mcp_config).join(', ') ||
    t('components.library.templateConfigView.empty.value')
  rows.push({
    label: t('components.library.templateConfigView.sections.mcpServers'),
    old: oldServers,
    new_: newServers,
  })

  // Resources
  const rFields: (keyof ComputeResources)[] = [
    'cpu_request',
    'cpu_limit',
    'memory_request',
    'memory_limit',
    'storage',
  ]
  const resourceFieldLabels: Record<keyof ComputeResources, string> = {
    cpu_request: t('components.library.templates.resourceFields.cpuRequest'),
    cpu_limit: t('components.library.templates.resourceFields.cpuLimit'),
    memory_request: t('components.library.templates.resourceFields.memoryRequest'),
    memory_limit: t('components.library.templates.resourceFields.memoryLimit'),
    storage: t('components.library.templates.resourceFields.storage'),
  }
  for (const f of rFields) {
    rows.push({
      label: resourceFieldLabels[f],
      old: oldConfig.compute_resources[f] || t('components.library.templateConfigView.empty.value'),
      new_:
        newConfig.compute_resources[f] || t('components.library.templateConfigView.empty.value'),
    })
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: old version */}
      <div className="flex-1 min-w-0 flex flex-col border-r border-border">
        <div className="shrink-0 px-4 py-2 text-mini text-muted-foreground/50 bg-destructive/5">
          {oldLabel}
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {rows.map((row) => {
            const changed = row.old !== row.new_
            return (
              <div key={row.label}>
                <div className="text-mini text-muted-foreground/50 uppercase tracking-wider mb-0.5">
                  {row.label}
                </div>
                <div
                  className={`text-xs font-mono ${changed ? 'text-destructive bg-destructive/5 rounded px-1.5 py-0.5 -mx-1.5' : 'text-muted-foreground'}`}
                >
                  {row.old}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {/* Right: new version */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="shrink-0 px-4 py-2 text-mini text-muted-foreground/50 bg-success/5">
          {newLabel}
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {rows.map((row) => {
            const changed = row.old !== row.new_
            return (
              <div key={row.label}>
                <div className="text-mini text-muted-foreground/50 uppercase tracking-wider mb-0.5">
                  {row.label}
                </div>
                <div
                  className={`text-xs font-mono ${changed ? 'text-success bg-success/5 rounded px-1.5 py-0.5 -mx-1.5' : 'text-muted-foreground'}`}
                >
                  {row.new_}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function TemplatesSection({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation()
  const { open: openDialog } = useDialogStack()
  const { prompts } = usePrompts()
  const { prompts: publicPrompts } = usePublicPrompts()
  const allPrompts = [
    ...prompts,
    ...publicPrompts.filter((pp) => !prompts.some((p) => p.id === pp.id)),
  ]
  const queryClient = useQueryClient()

  const { data: providers = [] } = useQuery<ApiModelProvider[]>({
    queryKey: ['providers'],
    queryFn: () => api.listProviders(),
  })

  const { templates, isLoading } = useTemplates()
  const headerSlot = useAppHeaderSlot()
  const [selectedId, setSelectedId] = useInstancePersistentState<string | null>(
    instanceId,
    'templatesSelectedId',
    () => null,
  )
  const [search, setSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useInstancePersistentState<ScopeFilter>(
    instanceId,
    'templatesScopeFilter',
    () => 'all',
  )
  const [editMode, setEditMode] = useState(false)

  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editConfig, setEditConfig] = useState<ConfigFormValues>({ ...INITIAL_CONFIG_VALUES })
  const [saveError, setSaveError] = useState<string | null>(null)

  const [previewVersion, setPreviewVersion] = useState<ApiTemplateVersion | null>(null)
  const [selectedConfig, setSelectedConfig] = useState<ConfigFormValues | null>(null)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)

  const scopeCounts = useMemo(() => {
    const c: Partial<Record<ScopeFilter, number>> = {
      all: templates.length,
      private: 0,
      team: 0,
      public: 0,
    }
    for (const tpl of templates) {
      if (tpl.visibility === 'public') c.public = (c.public ?? 0) + 1
      else if (tpl.visibility === 'team') c.team = (c.team ?? 0) + 1
      else c.private = (c.private ?? 0) + 1
    }
    return c
  }, [templates])

  const displayedTemplates = templates.filter((tpl) => {
    if (scopeFilter !== 'all' && tpl.visibility !== scopeFilter) return false
    if (search && !tpl.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  const selectedTemplate = templates.find((t) => t.id === selectedId) ?? null
  const isOwner = selectedTemplate?.is_owner ?? false
  const isEditor = selectedTemplate?.is_owner || selectedTemplate?.my_permission === 'editor'

  // Versions: load eagerly when a template is selected so we can derive selectedConfig
  // (latest version's config powers the read-only view).
  const versionsQuery = useQuery<ApiTemplateVersion[]>({
    queryKey: ['template-versions', selectedId],
    queryFn: () => api.listTemplateVersions(selectedId as string),
    enabled: !!selectedId,
  })
  const versions = versionsQuery.data ?? []
  const versionsLoading = versionsQuery.isLoading

  // Reset transient state when selection changes
  useEffect(() => {
    setEditMode(false)
    setPreviewVersion(null)
    setSaveError(null)
    setSelectedConfig(null)
  }, [selectedId])

  // Derive selectedConfig from latest version whenever versions load/change
  useEffect(() => {
    if (versions.length > 0) {
      const latest = versions.reduce((a, b) => (a.version > b.version ? a : b))
      setSelectedConfig(versionToConfig(latest))
    }
  }, [versions])

  const updateTemplateMutation = useMutation({
    mutationFn: (data: { id: string; name: string; description: string }) =>
      api.updateTemplate(data.id, { name: data.name, description: data.description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templatesQueryKey })
    },
  })

  const createVersionMutation = useMutation({
    mutationFn: (data: {
      templateId: string
      payload: Parameters<typeof api.createTemplateVersion>[1]
    }) => api.createTemplateVersion(data.templateId, data.payload),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: templatesQueryKey })
      queryClient.invalidateQueries({ queryKey: ['template-versions', vars.templateId] })
    },
  })

  const deleteTemplateMutation = useMutation({
    mutationFn: (id: string) => api.deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templatesQueryKey })
    },
  })

  const handleSelect = useCallback((id: string) => setSelectedId(id), [setSelectedId])

  function enterEditMode(tmpl: ApiTemplate) {
    setEditName(tmpl.name)
    setEditDescription(tmpl.description || '')
    // Use the currently displayed config (could be a specific version)
    const config = previewVersion
      ? versionToConfig(previewVersion)
      : (selectedConfig ?? { ...INITIAL_CONFIG_VALUES })
    setEditConfig(config)
    setEditMode(true)
    setSaveError(null)
  }

  function cancelEdit() {
    setEditMode(false)
    setSaveError(null)
  }

  async function handleSave() {
    if (!selectedId || !selectedTemplate) return
    const c = editConfig
    if (!editName.trim()) {
      setSaveError(t('components.library.templates.errors.nameRequired'))
      return
    }
    if (!c.agent_type) {
      setSaveError(t('components.library.templates.errors.agentTypeRequired'))
      return
    }
    if (!c.provider_id) {
      setSaveError(t('components.library.templates.errors.providerRequired'))
      return
    }
    if (!c.model.trim()) {
      setSaveError(t('components.library.templates.errors.modelRequired'))
      return
    }

    setSaveError(null)
    try {
      const metaChanged =
        editName !== selectedTemplate.name ||
        editDescription !== (selectedTemplate.description || '')
      if (metaChanged) {
        await updateTemplateMutation.mutateAsync({
          id: selectedId,
          name: editName,
          description: editDescription,
        })
      }
      await createVersionMutation.mutateAsync({
        templateId: selectedId,
        payload: {
          agent_type: c.agent_type,
          prompt_id: c.prompt_id || null,
          mcp_config: c.mcp_config,
          agent_settings: c.agent_settings,
          compute_resources: c.compute_resources,
          provider_id: c.provider_id || null,
          model: c.model,
          small_model: c.small_model,
          skill_ids: c.skill_ids,
          commands: c.commands.map((cmd) => ({
            name: cmd.name,
            type: cmd.type,
            prompt_id: cmd.prompt_id,
            content: cmd.prompt_id ? '' : cmd.content,
          })),
          schedules: c.schedules.map((s) => ({
            name: s.name,
            cron: s.cron,
            timezone: s.timezone,
            prompt: s.prompt_id ? '' : s.prompt,
            prompt_id: s.prompt_id,
            enabled_default: s.enabled_default,
          })),
          // Carried through, not edited here — preserve the shipped layout link.
          layout_id: c.layout_id ?? null,
        },
      })
      setEditMode(false)
      setPreviewVersion(null)
    } catch (err) {
      setSaveError(formatTemplateLinkError(err))
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteTemplateMutation.mutateAsync(id)
      toast.success(t('components.library.templates.toasts.deleted'))
      if (selectedId === id) setSelectedId(null)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('components.library.templates.errors.deleteFailed'),
      )
    }
  }

  async function handleRollback() {
    if (!selectedTemplate || !previewVersion) return
    const oldConfig = versionToConfig(previewVersion)

    try {
      await createVersionMutation.mutateAsync({
        templateId: selectedTemplate.id,
        payload: {
          agent_type: oldConfig.agent_type,
          prompt_id: oldConfig.prompt_id || null,
          mcp_config: oldConfig.mcp_config,
          agent_settings: oldConfig.agent_settings,
          compute_resources: oldConfig.compute_resources,
          provider_id: oldConfig.provider_id || null,
          model: oldConfig.model,
          small_model: oldConfig.small_model,
          skill_ids: oldConfig.skill_ids,
          commands: oldConfig.commands.map((cmd) => ({
            name: cmd.name,
            type: cmd.type,
            prompt_id: cmd.prompt_id,
            content: cmd.prompt_id ? '' : cmd.content,
          })),
          schedules: oldConfig.schedules.map((s) => ({
            name: s.name,
            cron: s.cron,
            timezone: s.timezone,
            prompt: s.prompt_id ? '' : s.prompt,
            prompt_id: s.prompt_id,
            enabled_default: s.enabled_default,
          })),
          layout_id: oldConfig.layout_id ?? null,
        },
      })
      toast.success(
        t('components.library.templates.toasts.rolledBack', { version: previewVersion.version }),
      )
      setPreviewVersion(null)
    } catch (err) {
      toast.error(formatTemplateLinkError(err))
    }
  }

  const isSaving = updateTemplateMutation.isPending || createVersionMutation.isPending

  // The config to display in view mode
  const viewConfig = previewVersion ? versionToConfig(previewVersion) : selectedConfig
  const currentVersion = previewVersion
    ? previewVersion.version
    : (selectedTemplate?.latest_version ?? 0)

  const openCreate = () => openDialog('create-template')

  return (
    <div className="flex h-full overflow-hidden">
      {headerSlot &&
        createPortal(
          <>
            <AppHeaderButton
              icon={Plus}
              label={t('components.library.templates.actions.new')}
              onClick={openCreate}
            />
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-foreground/[0.10]" />
            <ResourceFilterTabs
              value={scopeFilter}
              onValueChange={setScopeFilter}
              counts={scopeCounts}
            />
          </>,
          headerSlot,
        )}

      {/* ── Left: Template List ── */}
      <MasterSidebar width="md">
        <MasterSidebar.Search value={search} onChange={setSearch} />
        <MasterSidebar.List>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner size="sm" />
            </div>
          ) : displayedTemplates.length === 0 ? (
            search ? (
              <EmptyHero
                className="py-6"
                illustration={<EmptyIllustration src="search" size="h-20" />}
                title={t('components.workspaceChat.empty.noMatches')}
              />
            ) : (
              <EmptyHero
                className="py-6"
                illustration={<EmptyIllustration src="templates" size="h-20" />}
                title={t('components.library.templates.empty.noTemplates.title')}
                description={t('components.library.templates.empty.noTemplates.description')}
                action={
                  <Button type="button" size="sm" variant="outline" onClick={openCreate}>
                    <Plus className="mr-1 h-3 w-3" />
                    {t('components.library.templates.actions.new')}
                  </Button>
                }
              />
            )
          ) : (
            displayedTemplates.map((template) => (
              <MasterSidebar.Item
                key={template.id}
                selected={selectedId === template.id}
                onSelect={() => handleSelect(template.id)}
                trailing={
                  <span className="text-tiny tabular-nums text-muted-foreground/60">
                    v{template.latest_version}
                  </span>
                }
              >
                {template.name}
              </MasterSidebar.Item>
            ))
          )}
        </MasterSidebar.List>
      </MasterSidebar>

      {/* ── Right: Detail / Edit ── */}
      {editMode && selectedTemplate ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Edit header — ghost name + description inputs (no surrounding
              chrome) keep the focus on content. */}
          <div className="shrink-0 space-y-1 px-5 py-3">
            <div className="flex items-center gap-3">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-auto flex-1 min-w-0 border-0 bg-transparent px-0 text-sm font-semibold shadow-none placeholder:text-muted-foreground/30 focus-visible:ring-0"
                placeholder={t('components.saveAsTemplate.placeholders.name')}
              />
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={cancelEdit}
                  disabled={isSaving}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleSave}
                  disabled={isSaving || !editName.trim()}
                >
                  {isSaving && <Spinner size="sm" className="mr-1" />}
                  {t('components.library.templates.actions.saveNewVersion')}
                </Button>
              </div>
            </div>
            <Textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={2}
              className="min-h-0 resize-none border-0 bg-transparent px-0 py-0 text-xs text-muted-foreground shadow-none placeholder:text-muted-foreground/30 focus-visible:ring-0"
              placeholder={t('components.saveAsTemplate.placeholders.description')}
            />
          </div>
          {saveError && (
            <div className="mx-5 mb-2 whitespace-pre-line rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {saveError}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            <ConfigFormFields values={editConfig} onChange={setEditConfig} showAutomation />
          </div>
        </div>
      ) : selectedTemplate ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Detail header — name + by-owner caption + version chip + actions.
              Description is dropped here; it lives inside the config view. */}
          <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-3">
            <div className="flex items-start gap-2 min-w-0">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{selectedTemplate.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {t('components.library.templates.labels.byOwner', {
                    owner: selectedTemplate.owner_name,
                  })}
                </p>
              </div>
              <Select
                value={String(currentVersion)}
                onValueChange={(val) => {
                  const ver = Number(val)
                  if (ver === selectedTemplate.latest_version) {
                    setPreviewVersion(null)
                  } else {
                    const v = versions.find((x) => x.version === ver)
                    if (v) setPreviewVersion(v)
                  }
                }}
                onOpenChange={(open) => {
                  if (open) {
                    queryClient.invalidateQueries({
                      queryKey: ['template-versions', selectedTemplate.id],
                    })
                  }
                }}
              >
                <SelectTrigger className="h-6 w-auto gap-1 border-0 bg-foreground/[0.06] px-2 text-tiny shadow-none focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {versionsLoading ? (
                    <div className="flex justify-center py-2">
                      <Spinner size="sm" />
                    </div>
                  ) : versions.length === 0 ? (
                    <SelectItem value={String(selectedTemplate.latest_version)} className="text-xs">
                      v{selectedTemplate.latest_version}
                    </SelectItem>
                  ) : (
                    versions
                      .sort((a, b) => b.version - a.version)
                      .map((v) => (
                        <SelectItem key={v.version} value={String(v.version)} className="text-xs">
                          v{v.version}
                          {v.version === selectedTemplate.latest_version
                            ? t('components.library.templates.labels.latestVersionSuffix')
                            : ''}
                        </SelectItem>
                      ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <ScopeBadge scope={selectedTemplate.visibility} compact />
              {isOwner && previewVersion && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={handleRollback}
                >
                  <RotateCcw className="h-3 w-3" />{' '}
                  {t('components.library.templates.actions.rollbackTo', {
                    version: previewVersion.version,
                  })}
                </Button>
              )}
              {isOwner && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => setShareDialogOpen(true)}
                  title={t('components.library.templates.actions.share')}
                >
                  <Share2 className="h-3.5 w-3.5" />
                </Button>
              )}
              {isEditor && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => enterEditMode(selectedTemplate)}
                  title={t('components.library.templates.actions.edit')}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
              {isOwner && (
                <ConfirmButton
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onConfirm={() => handleDelete(selectedTemplate.id)}
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  tooltip={t('components.library.templates.actions.delete')}
                />
              )}
            </div>
          </div>

          {/* Config summary */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
            {versionsLoading ? (
              <div className="flex justify-center py-8">
                <Spinner size="sm" />
              </div>
            ) : previewVersion && selectedConfig && viewConfig ? (
              <ConfigDiff
                oldConfig={viewConfig}
                newConfig={selectedConfig}
                oldLabel={`v${previewVersion.version}`}
                newLabel={`v${selectedTemplate.latest_version}`}
                providers={providers}
                prompts={allPrompts}
              />
            ) : viewConfig ? (
              <TemplateConfigView
                agentType={viewConfig.agent_type}
                providerName={(() => {
                  const provider = providers.find((p) => p.id === viewConfig.provider_id)
                  if (provider) return `${provider.name} (${provider.provider_type})`
                  const ver =
                    previewVersion ??
                    versions.find((v) => v.version === selectedTemplate.latest_version)
                  if (ver?.provider_name) return ver.provider_name
                  return viewConfig.provider_id || undefined
                })()}
                model={viewConfig.model}
                smallModel={viewConfig.small_model}
                promptId={viewConfig.prompt_id || undefined}
                promptName={(() => {
                  const prompt = viewConfig.prompt_id
                    ? allPrompts.find((p) => p.id === viewConfig.prompt_id)
                    : null
                  return (
                    prompt?.name ||
                    (viewConfig.prompt_id
                      ? t('components.library.templates.labels.privatePrompt')
                      : undefined)
                  )
                })()}
                promptContent={(() => {
                  const prompt = viewConfig.prompt_id
                    ? allPrompts.find((p) => p.id === viewConfig.prompt_id)
                    : null
                  return (
                    prompt?.content ||
                    (
                      previewVersion ??
                      versions.find((v) => v.version === selectedTemplate.latest_version)
                    )?.system_prompt
                  )
                })()}
                mcpServers={(() => {
                  try {
                    const parsed = JSON.parse(viewConfig.mcp_config)
                    return parsed?.mcpServers ?? parsed
                  } catch {
                    return undefined
                  }
                })()}
                agentSettings={(() => {
                  try {
                    const parsed = JSON.parse(viewConfig.agent_settings)
                    return parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0
                      ? parsed
                      : undefined
                  } catch {
                    return undefined
                  }
                })()}
                skillNames={(() => {
                  // p3: version carries `skill_ids` (authoritative) plus
                  // `skill_names` (display denormalized via JOIN). Pull the
                  // names off the source version object so the view doesn't
                  // need to do a separate lookup.
                  const ver =
                    previewVersion ??
                    versions.find((v) => v.version === selectedTemplate.latest_version)
                  return ver?.skill_names ?? viewConfig.skill_ids
                })()}
                resources={{
                  cpuRequest: viewConfig.compute_resources.cpu_request,
                  cpuLimit: viewConfig.compute_resources.cpu_limit,
                  memoryRequest: viewConfig.compute_resources.memory_request,
                  memoryLimit: viewConfig.compute_resources.memory_limit,
                  storage: viewConfig.compute_resources.storage,
                  presetLabel: matchResourcePreset(viewConfig.compute_resources),
                }}
                commands={viewConfig.commands}
                schedules={viewConfig.schedules}
                layoutId={viewConfig.layout_id}
              />
            ) : (
              <div className="text-xs text-muted-foreground/40">
                {t('components.library.templates.empty.noVersionData')}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-muted-foreground/60">
              {t('components.library.templates.empty.selectTemplate')}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={openCreate}
            >
              <Plus className="mr-1 h-3 w-3" />{' '}
              {t('components.library.templates.actions.createNew')}
            </Button>
          </div>
        </div>
      )}

      <TemplateShareDialog
        template={selectedTemplate}
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
      />
    </div>
  )
}
