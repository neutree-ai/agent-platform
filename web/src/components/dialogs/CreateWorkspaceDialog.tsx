import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SaveButton } from '@/components/ui/save-button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  ConfigFormFields,
  type ConfigFormValues,
  INITIAL_CONFIG_VALUES,
} from '@/components/workspace/ConfigFormFields'
import {
  type ConsentSchedule,
  ScheduleConsentList,
  resolveScheduleOverrides,
} from '@/components/workspace/ScheduleConsentList'
import { useAuth } from '@/contexts/AuthContext'
import type { DialogProps } from '@/contexts/DialogStackContext'
import { type AgentConfigSection, joinAgentConfigDocs } from '@/docs/inline-help/agent-config-docs'
import { useEnvironments } from '@/hooks/useEnvironments'
import { useTemplates } from '@/hooks/useTemplates'
import { useCreateWorkspace } from '@/hooks/useWorkspaces'
import { api } from '@/lib/api/client'
import type { ApiTemplate } from '@/lib/api/types'
import { useQuery } from '@tanstack/react-query'
import { ChevronsUpDown, Globe, Lock, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

function VisibilityIcon({
  visibility,
  className,
}: {
  visibility: ApiTemplate['visibility']
  className?: string
}) {
  if (visibility === 'public') return <Globe className={className} />
  if (visibility === 'team') return <Users className={className} />
  return <Lock className={className} />
}

function OwnerTag({ tpl }: { tpl: ApiTemplate }) {
  const { t } = useTranslation()
  return (
    <span className="text-muted-foreground">
      {tpl.is_owner
        ? t('components.createWorkspace.template.ownerMine')
        : t('components.createWorkspace.template.ownerBy', { name: tpl.owner_name })}
    </span>
  )
}

function TemplateCombobox({
  templates,
  value,
  onChange,
  disabled,
}: {
  templates: ApiTemplate[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selected = templates.find((tpl) => tpl.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-9 w-full justify-between text-xs font-normal"
          disabled={disabled}
        >
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              <VisibilityIcon
                visibility={selected.visibility}
                className="h-3 w-3 shrink-0 text-muted-foreground"
              />
              <span className="truncate">{selected.name}</span>
              <span className="shrink-0 text-mini">
                <OwnerTag tpl={selected} />
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              {t('components.createWorkspace.template.placeholder')}
            </span>
          )}
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] overflow-hidden p-0"
        align="start"
        sideOffset={4}
      >
        <Command className="overflow-hidden">
          <CommandInput
            placeholder={t('components.createWorkspace.template.searchPlaceholder')}
            className="h-8 text-xs"
          />
          <CommandList className="max-h-[240px]">
            <CommandEmpty className="py-3 text-center text-xs">
              {t('components.createWorkspace.template.empty')}
            </CommandEmpty>
            <CommandGroup>
              {templates.map((tpl) => (
                <CommandItem
                  key={tpl.id}
                  // Include owner_name + id so cmdk treats each row as unique
                  // even when two templates share name/description, and so the
                  // search input can filter by owner.
                  value={`${tpl.name} ${tpl.owner_name} ${tpl.description} ${tpl.id}`}
                  onSelect={() => {
                    onChange(tpl.id === value ? '' : tpl.id)
                    setOpen(false)
                  }}
                  className="py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <VisibilityIcon
                        visibility={tpl.visibility}
                        className="h-3 w-3 shrink-0 text-muted-foreground"
                      />
                      <span className="truncate text-xs font-medium">{tpl.name}</span>
                      <span className="shrink-0 text-mini">
                        <OwnerTag tpl={tpl} />
                      </span>
                    </div>
                    {tpl.description && (
                      <div className="mt-0.5 truncate pl-5 text-mini text-muted-foreground">
                        {tpl.description}
                      </div>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

type Mode = 'template' | 'blank'

interface FormState {
  name: string
  mode: Mode
  selectedTemplate: string
  isSystem: boolean
  /** Target environment id; 'builtin' = the built-in environment (default). */
  environmentId: string
  config: ConfigFormValues
}

const INITIAL_FORM: FormState = {
  name: '',
  mode: 'template',
  selectedTemplate: '',
  isSystem: false,
  environmentId: 'builtin',
  config: { ...INITIAL_CONFIG_VALUES },
}

/**
 * Create-workspace dialog — registered against the DialogStack so the same
 * dialog reaches from Home, the Command Palette, and any future entry
 * point via `openDialog('create-workspace')`. Mirrors the
 * CreateTemplateDialog shape (form + ConfigFormFields + DocumentedDialog).
 */
export default function CreateWorkspaceDialog({ open, onOpenChange }: DialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const createMutation = useCreateWorkspace()
  const { templates } = useTemplates()
  const { data: environments = [] } = useEnvironments()
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [visibleSections, setVisibleSections] = useState<AgentConfigSection[]>(['model'])

  const [scheduleOverrides, setScheduleOverrides] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (open) {
      setForm(INITIAL_FORM)
      setVisibleSections(['model'])
    }
  }, [open])

  // Template schedules that need recipient consent before they auto-run.
  const selectedTpl = templates?.find((tpl) => tpl.id === form.selectedTemplate)
  const { data: selectedVersion } = useQuery({
    queryKey: ['template-version', selectedTpl?.id, selectedTpl?.latest_version],
    queryFn: () => api.getTemplateVersion(selectedTpl!.id, selectedTpl!.latest_version),
    enabled: form.mode === 'template' && !!selectedTpl,
  })
  // ApiTemplateVersionSchedule is a structural superset of ConsentSchedule.
  const consentSchedules: ConsentSchedule[] = selectedVersion?.schedules ?? []

  // Reset consent toggles whenever the picked template changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on template change
  useEffect(() => {
    setScheduleOverrides({})
  }, [form.selectedTemplate])

  const isAdmin = user?.role === 'admin'
  const hasTemplates = templates && templates.length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const { name, mode, selectedTemplate, isSystem, environmentId, config } = form
    // 'builtin' is the implicit default — omit it so the backend picks built-in.
    const environment_id = environmentId && environmentId !== 'builtin' ? environmentId : undefined
    try {
      const ws = await createMutation.mutateAsync(
        mode === 'template'
          ? {
              name,
              template_id: selectedTemplate || undefined,
              is_system: isSystem || undefined,
              environment_id,
              schedule_overrides:
                consentSchedules.length > 0
                  ? resolveScheduleOverrides(consentSchedules, scheduleOverrides)
                  : undefined,
            }
          : {
              name,
              is_system: isSystem || undefined,
              environment_id,
              agent_type: config.agent_type,
              compute_resources: config.compute_resources,
              provider_id: config.provider_id || undefined,
              model: config.model || undefined,
              small_model: config.small_model || undefined,
              prompt_id: config.prompt_id || undefined,
              mcp_config: config.mcp_config !== '{}' ? config.mcp_config : undefined,
              agent_settings: config.agent_settings !== '{}' ? config.agent_settings : undefined,
              skill_ids: config.skill_ids.length > 0 ? config.skill_ids : undefined,
            },
      )
      onOpenChange(false)
      navigate(`/w/${ws.id}`)
    } catch {
      // Surfaced via createMutation.isError below.
    }
  }

  return (
    <DocumentedDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('components.createWorkspace.title')}
      size="lg"
      docs={
        form.mode === 'blank'
          ? joinAgentConfigDocs(visibleSections, form.config.agent_type)
          : undefined
      }
      footer={
        <>
          <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <SaveButton
            type="submit"
            form="create-workspace"
            size="sm"
            isSaving={createMutation.isPending}
            disabled={form.mode === 'template' && !form.selectedTemplate}
            label={t('common.create')}
          />
        </>
      }
    >
      <form id="create-workspace" onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="workspace-name" className="text-xs">
            {t('components.createWorkspace.fields.name')}
          </Label>
          <Input
            id="workspace-name"
            type="text"
            placeholder={t('components.createWorkspace.placeholders.name')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            disabled={createMutation.isPending}
          />
        </div>

        {isAdmin && (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded"
              checked={form.isSystem}
              onChange={(e) => setForm((f) => ({ ...f, isSystem: e.target.checked }))}
              disabled={createMutation.isPending}
            />
            <span className="text-xs text-muted-foreground">
              {t('components.createWorkspace.fields.systemWorkspace')}
            </span>
          </label>
        )}

        <div className="space-y-2">
          <Label className="text-xs">{t('components.createWorkspace.fields.environment')}</Label>
          {form.isSystem ? (
            // System workspaces always run on the built-in environment.
            <p className="text-xs text-muted-foreground">
              {t('components.createWorkspace.environment.builtin')}
            </p>
          ) : (
            <Combobox
              value={form.environmentId}
              onValueChange={(environmentId) =>
                setForm((f) => ({ ...f, environmentId: environmentId || 'builtin' }))
              }
              options={environments.map((e) => ({
                value: e.id,
                label: e.is_builtin ? t('components.createWorkspace.environment.builtin') : e.name,
                description:
                  !e.is_builtin && e.status !== 'online'
                    ? t('components.createWorkspace.environment.offline')
                    : undefined,
                disabled: !e.is_builtin && e.status !== 'online',
              }))}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <Label className="text-xs">{t('components.createWorkspace.fields.mode')}</Label>
          <SegmentedControl<Mode>
            value={form.mode}
            onValueChange={(mode) => setForm((f) => ({ ...f, mode }))}
            variant="box"
            size="md"
            options={[
              { value: 'template', label: t('components.createWorkspace.modes.template') },
              { value: 'blank', label: t('components.createWorkspace.modes.blank') },
            ]}
          />
        </div>

        {form.mode === 'template' ? (
          <>
            <div className="space-y-2">
              <Label className="text-xs">{t('components.createWorkspace.fields.template')}</Label>
              {hasTemplates ? (
                <TemplateCombobox
                  templates={templates}
                  value={form.selectedTemplate}
                  onChange={(selectedTemplate) => setForm((f) => ({ ...f, selectedTemplate }))}
                  disabled={createMutation.isPending}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t('components.createWorkspace.template.noTemplates')}
                </p>
              )}
            </div>
            {consentSchedules.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs">{t('components.scheduleConsent.title')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('components.scheduleConsent.description')}
                </p>
                <ScheduleConsentList
                  schedules={consentSchedules}
                  overrides={scheduleOverrides}
                  onChange={setScheduleOverrides}
                />
              </div>
            )}
          </>
        ) : (
          <ConfigFormFields
            values={form.config}
            onChange={(config) => setForm((f) => ({ ...f, config }))}
            onVisibleSections={setVisibleSections}
          />
        )}

        {createMutation.isError && (
          <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
            {createMutation.error?.message || t('components.createWorkspace.errors.createFailed')}
          </div>
        )}
      </form>
    </DocumentedDialog>
  )
}
