import {
  type ProviderForm,
  type ProviderFormErrors,
  ProviderFormFields,
  validateProviderForm,
} from '@/components/dialogs/ProviderFormFields'
import { ResourceCard } from '@/components/resource/ResourceCard'
import { ResourceFilterTabs, type ScopeFilter } from '@/components/resource/ResourceFilterTabs'
import { ResourceGrid } from '@/components/resource/ResourceGrid'
import type { ResourceScope } from '@/components/resource/ScopeBadge'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import { SaveButton } from '@/components/ui/save-button'
import { TestButton, TestResult } from '@/components/workspace/agent-config/ModelPicker'
import { useDialogStack } from '@/contexts/DialogStackContext'
import { getProviderDoc, getProviderDocsHint } from '@/docs/inline-help/provider-docs'
import { useDeleteProvider, useProviders, useUpdateProvider } from '@/hooks/useProviders'
import { api } from '@/lib/api/client'
import type { ApiModelProvider } from '@/lib/api/types'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

const INITIAL_FORM: ProviderForm = {
  name: '',
  description: '',
  provider_type: 'anthropic',
  base_url: '',
  api_key: '',
  visibility: 'private',
  team_ids: [],
}

export function ProvidersSection({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation()
  const { open: openDialog } = useDialogStack()
  const { data: providers = [] } = useProviders()
  const updateProvider = useUpdateProvider()
  const deleteProvider = useDeleteProvider()
  const headerSlot = useAppHeaderSlot()

  const [scopeFilter, setScopeFilter] = useInstancePersistentState<ScopeFilter>(
    instanceId,
    'scopeFilter',
    () => 'all',
  )

  const counts = useMemo(() => {
    const c: Partial<Record<ScopeFilter, number>> = {
      all: providers.length,
      private: 0,
      team: 0,
      public: 0,
    }
    for (const p of providers) {
      if (p.visibility === 'public') c.public = (c.public ?? 0) + 1
      else if (p.visibility === 'team') c.team = (c.team ?? 0) + 1
      else c.private = (c.private ?? 0) + 1
    }
    return c
  }, [providers])

  const filtered = useMemo(() => {
    if (scopeFilter === 'all') return providers
    return providers.filter((p) => p.visibility === scopeFilter)
  }, [providers, scopeFilter])

  const [generalError, setGeneralError] = useState<string | null>(null)
  const [errors, setErrors] = useState<ProviderFormErrors>({})
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ProviderForm>(INITIAL_FORM)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testDetail, setTestDetail] = useState('')

  // Pre-load existing grants when opening edit dialog for a team-shared provider
  useEffect(() => {
    if (!dialogOpen || !editingId) return
    const existing = providers.find((p) => p.id === editingId)
    if (!existing || existing.visibility !== 'team') return
    api
      .listProviderGrants(editingId)
      .then((grants) => {
        setForm((f) => ({ ...f, team_ids: grants.map((g) => g.team_id) }))
      })
      .catch(() => {})
  }, [dialogOpen, editingId, providers])

  function openCreate() {
    openDialog('create-provider')
  }

  function openEdit(p: ApiModelProvider) {
    setForm({
      name: p.name,
      description: p.description,
      provider_type: p.provider_type,
      base_url: p.base_url,
      api_key: '',
      visibility: p.visibility,
      team_ids: [],
    })
    setEditingId(p.id)
    setErrors({})
    setGeneralError(null)
    setTestState('idle')
    setTestDetail('')
    setDialogOpen(true)
  }

  // Probe the currently-edited (unsaved) config in place. A blank api_key keeps
  // the stored key (mirrors the save-time "blank = unchanged" convention).
  async function handleTest() {
    if (!editingId) return
    setTestState('testing')
    setTestDetail('')
    try {
      const res = await api.testProvider(editingId, {
        provider_type: form.provider_type,
        base_url: form.base_url,
        api_key: form.api_key,
      })
      setTestState(res.ok ? 'ok' : 'fail')
      setTestDetail(res.detail || '')
    } catch (err) {
      setTestState('fail')
      setTestDetail(err instanceof Error ? err.message : t('common.errors.requestFailed'))
    }
  }

  async function handleSave() {
    const next = validateProviderForm(form, { isEditing: true })
    setErrors(next)
    if (Object.keys(next).length > 0) return
    if (!editingId) return
    setGeneralError(null)
    const { team_ids, visibility, ...rest } = form
    const payload: Parameters<typeof updateProvider.mutateAsync>[0] = {
      id: editingId,
      ...rest,
      visibility,
      grants:
        visibility === 'team'
          ? team_ids.map((team_id) => ({ team_id, permission: 'viewer' as const }))
          : [],
    }
    if (!payload.api_key) {
      // biome-ignore lint/performance/noDelete: must drop the key, undefined would still be persisted
      delete (payload as Record<string, unknown>).api_key
    }
    try {
      await updateProvider.mutateAsync(payload)
      setDialogOpen(false)
    } catch (err) {
      setGeneralError(
        err instanceof Error ? err.message : t('components.management.providers.errors.saveFailed'),
      )
    }
  }

  const localizedErrors: ProviderFormErrors = {
    name: errors.name ? t(errors.name) : undefined,
    baseUrl: errors.baseUrl ? t(errors.baseUrl) : undefined,
    apiKey: errors.apiKey ? t(errors.apiKey) : undefined,
    teams: errors.teams ? t(errors.teams) : undefined,
  }

  return (
    <>
      {headerSlot &&
        createPortal(
          <>
            <AppHeaderButton
              icon={Plus}
              label={t('components.management.providers.actions.new')}
              onClick={openCreate}
            />
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-foreground/[0.10]" />
            <ResourceFilterTabs
              value={scopeFilter}
              onValueChange={setScopeFilter}
              counts={counts}
            />
          </>,
          headerSlot,
        )}

      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {providers.length === 0 ? (
            <EmptyState onCreate={openCreate} />
          ) : filtered.length === 0 ? (
            <FilterEmptyState />
          ) : (
            <ResourceGrid>
              {filtered.map((p) => {
                const scope: ResourceScope = p.visibility
                return (
                  <ResourceCard
                    key={p.id}
                    name={p.name}
                    description={p.description || undefined}
                    type={p.provider_type}
                    meta={p.base_url || undefined}
                    scope={scope}
                    owned={p.is_owner}
                    actions={
                      p.is_owner && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            onClick={() => openEdit(p)}
                            aria-label={t('components.management.providers.actions.edit')}
                            title={t('components.management.providers.actions.edit')}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <ConfirmButton
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            disabled={deleteProvider.isPending}
                            onConfirm={() => deleteProvider.mutate(p.id)}
                            icon={<Trash2 className="h-3 w-3" />}
                            tooltip={t('components.management.providers.actions.delete')}
                          />
                        </>
                      )
                    }
                  />
                )
              })}
            </ResourceGrid>
          )}
        </div>
      </div>

      <DocumentedDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t('components.management.providers.dialogs.editTitle')}
        docs={getProviderDoc(form.provider_type)}
        docsHint={getProviderDocsHint()}
        footer={
          <>
            <TestButton
              providerId={editingId ?? ''}
              state={testState}
              onRun={handleTest}
              className="mr-auto"
            />
            <Button type="button" size="sm" variant="ghost" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <SaveButton
              isSaving={updateProvider.isPending}
              onClick={handleSave}
              label={t('common.update')}
            />
          </>
        }
      >
        <ProviderFormFields
          form={form}
          setForm={(next) => {
            // A config edit invalidates the previous probe result.
            setTestState('idle')
            setTestDetail('')
            setForm(next)
          }}
          errors={localizedErrors}
          isEditing
        />
        {testState !== 'idle' && (
          <div className="mt-3">
            <TestResult state={testState} detail={testDetail} />
          </div>
        )}
        {generalError && <div className="mt-3 text-xs text-destructive">{generalError}</div>}
      </DocumentedDialog>
    </>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation()
  return (
    <EmptyHero
      className="min-h-[16rem]"
      illustration={<EmptyIllustration src="providers" size="h-32" />}
      title={t('components.management.providers.empty.noProviders.title')}
      description={t('components.management.providers.empty.noProviders.description')}
      action={
        <Button type="button" size="sm" variant="outline" onClick={onCreate}>
          <Plus className="mr-1 h-3 w-3" />
          {t('components.management.providers.actions.new')}
        </Button>
      }
    />
  )
}

function FilterEmptyState() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full min-h-[12rem] items-center justify-center text-center text-xs text-muted-foreground">
      {t('components.resource.filter.empty')}
    </div>
  )
}
