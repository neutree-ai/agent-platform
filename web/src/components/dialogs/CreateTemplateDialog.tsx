import { Button } from '@/components/ui/button'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SaveButton } from '@/components/ui/save-button'
import {
  ConfigFormFields,
  type ConfigFormValues,
  INITIAL_CONFIG_VALUES,
} from '@/components/workspace/ConfigFormFields'
import type { DialogProps } from '@/contexts/DialogStackContext'
import { type AgentConfigSection, joinAgentConfigDocs } from '@/docs/inline-help/agent-config-docs'
import { templatesQueryKey } from '@/hooks/useTemplates'
import { api } from '@/lib/api/client'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface TemplateForm {
  name: string
  description: string
  config: ConfigFormValues
}

const INITIAL_TEMPLATE_FORM: TemplateForm = {
  name: '',
  description: '',
  config: { ...INITIAL_CONFIG_VALUES },
}

/**
 * Create-template dialog — registered against the DialogStack so the
 * same dialog is reachable from the Templates app and the Command
 * Palette via `openDialog('create-template')`.
 */
export default function CreateTemplateDialog({ open, onOpenChange }: DialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<TemplateForm>(INITIAL_TEMPLATE_FORM)
  const [visibleSections, setVisibleSections] = useState<AgentConfigSection[]>(['model'])
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(INITIAL_TEMPLATE_FORM)
      setVisibleSections(['model'])
      setError(null)
    }
  }, [open])

  async function handleSave() {
    const c = form.config
    if (!form.name.trim()) {
      setError(t('components.createTemplate.errors.nameRequired'))
      return
    }
    if (!c.agent_type) {
      setError(t('components.createTemplate.errors.agentTypeRequired'))
      return
    }
    if (!c.provider_id) {
      setError(t('components.createTemplate.errors.providerRequired'))
      return
    }
    if (!c.model.trim()) {
      setError(t('components.createTemplate.errors.modelRequired'))
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const tmpl = await api.createTemplate({
        name: form.name,
        description: form.description || undefined,
      })
      await api.createTemplateVersion(tmpl.id, {
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
      })
      queryClient.invalidateQueries({ queryKey: templatesQueryKey })
      toast.success(t('components.createTemplate.toasts.created'))
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('components.createTemplate.errors.createFailed'),
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <DocumentedDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('components.createTemplate.title')}
      size="lg"
      docs={joinAgentConfigDocs(visibleSections, form.config.agent_type)}
      footer={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <SaveButton
            isSaving={isSaving}
            onClick={handleSave}
            disabled={!form.name.trim()}
            label={t('common.create')}
          />
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="create-template-name" className="text-sm font-medium">
            {t('components.createTemplate.fields.name')}
          </Label>
          <Input
            id="create-template-name"
            className="h-9 text-sm"
            placeholder={t('components.createTemplate.placeholders.name')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="create-template-description" className="text-sm font-medium">
            {t('components.createTemplate.fields.description')}
          </Label>
          <Textarea
            id="create-template-description"
            className="min-h-[60px] text-sm"
            placeholder={t('components.createTemplate.placeholders.description')}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>

        <ConfigFormFields
          values={form.config}
          onChange={(config) => setForm((f) => ({ ...f, config }))}
          onVisibleSections={setVisibleSections}
          showAutomation
        />

        {error && <div className="text-xs text-destructive">{error}</div>}
      </div>
    </DocumentedDialog>
  )
}
