import {
  type CredentialForm,
  type CredentialFormErrors,
  CredentialFormFields,
  INITIAL_CREDENTIAL_FORM,
  validateCredentialForm,
} from '@/components/dialogs/CredentialFormFields'
import { ResourceCard } from '@/components/resource/ResourceCard'
import { ResourceGrid } from '@/components/resource/ResourceGrid'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import { SaveButton } from '@/components/ui/save-button'
import { Spinner } from '@/components/ui/spinner'
import { useDialogStack } from '@/contexts/DialogStackContext'
import { useWorkspaces } from '@/hooks/useWorkspaces'
import { api } from '@/lib/api/client'
import type { ApiCredentialMeta } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const credentialsQueryKey = ['credentials'] as const

export function CredentialsSection(_: { instanceId: string }) {
  const { t } = useTranslation()
  const { open: openDialog } = useDialogStack()
  const queryClient = useQueryClient()
  const headerSlot = useAppHeaderSlot()
  const { data: workspacesData } = useWorkspaces()
  const workspacesById = Object.fromEntries((workspacesData ?? []).map((w) => [w.id, w]))

  const { data: credentials = [] } = useQuery<ApiCredentialMeta[]>({
    queryKey: credentialsQueryKey,
    queryFn: () => api.listCredentials(),
  })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<CredentialForm>(INITIAL_CREDENTIAL_FORM)
  const [errors, setErrors] = useState<CredentialFormErrors>({})
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [editingName, setEditingName] = useState<string | null>(null)

  const upsertMutation = useMutation({
    mutationFn: async (data: CredentialForm & { editingName: string | null }) => {
      let value = data.value
      if (data.inject === 'file' && value && !value.endsWith('\n')) {
        value += '\n'
      }
      if (data.editingName && data.name !== data.editingName) {
        await api.deleteCredential(data.editingName)
      }
      await api.upsertCredential(data.name, {
        value,
        inject: data.inject,
        path: data.inject === 'file' ? data.path : undefined,
        mode: data.inject === 'file' ? data.mode : undefined,
        scope: data.scope,
        workspace_ids: data.scope === 'selected' ? data.workspaceIds : undefined,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: credentialsQueryKey })
      setDialogOpen(false)
    },
    onError: (err) => {
      setGeneralError(
        err instanceof Error ? err.message : t('components.createCredential.errors.saveFailed'),
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (name: string) => api.deleteCredential(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: credentialsQueryKey })
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : t('components.credentialsSection.errors.deleteFailed'),
      )
    },
  })

  const deletingName = deleteMutation.isPending ? (deleteMutation.variables ?? null) : null

  function openCreate() {
    openDialog('create-credential')
  }

  function openEdit(cred: ApiCredentialMeta) {
    setForm({
      preset: 'custom',
      sshKeyType: 'ed25519',
      name: cred.name,
      value: '',
      inject: cred.inject as 'env' | 'file',
      path: cred.path ?? '',
      mode: cred.mode ?? '',
      scope: cred.scope,
      workspaceIds: cred.workspace_ids ?? [],
    })
    setEditingName(cred.name)
    setErrors({})
    setGeneralError(null)
    setDialogOpen(true)
  }

  function handleSave() {
    const next = validateCredentialForm(form)
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setGeneralError(null)
    upsertMutation.mutate({ ...form, editingName })
  }

  const localizedErrors: CredentialFormErrors = {
    name: errors.name ? t(errors.name) : undefined,
    value: errors.value ? t(errors.value) : undefined,
    path: errors.path ? t(errors.path) : undefined,
    workspaceIds: errors.workspaceIds ? t(errors.workspaceIds) : undefined,
  }

  const globalCreds = credentials.filter((c) => c.scope === 'global')
  const selectedCreds = credentials.filter((c) => c.scope === 'selected')

  function renderCard(cred: ApiCredentialMeta) {
    return (
      <ResourceCard
        key={cred.name}
        name={cred.name}
        type={<InjectBadge inject={cred.inject} />}
        meta={
          cred.scope === 'selected' ? (
            <WorkspaceScopeMeta ids={cred.workspace_ids ?? []} byId={workspacesById} />
          ) : (
            cred.path || undefined
          )
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={() => openEdit(cred)}
              aria-label={t('components.credentialsSection.actions.edit')}
              title={t('components.credentialsSection.actions.edit')}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            {deletingName === cred.name ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground"
                disabled
              >
                <Spinner size="sm" className="h-3 w-3" />
              </Button>
            ) : (
              <ConfirmButton
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                disabled={deleteMutation.isPending}
                onConfirm={() => deleteMutation.mutate(cred.name)}
                icon={<Trash2 className="h-3 w-3" />}
                tooltip={t('components.credentialsSection.actions.delete')}
              />
            )}
          </>
        }
      />
    )
  }

  return (
    <>
      {headerSlot &&
        createPortal(
          <AppHeaderButton
            icon={Plus}
            label={t('components.credentialsSection.actions.new')}
            onClick={openCreate}
          />,
          headerSlot,
        )}

      <div className="h-full overflow-y-auto p-4">
        {credentials.length === 0 ? (
          <EmptyState onCreate={openCreate} />
        ) : (
          <div className="space-y-6">
            {globalCreds.length > 0 && (
              <section>
                <SectionHeader
                  title={t('components.credentialsSection.sections.global')}
                  description={t('components.credentialsSection.sections.globalDesc')}
                />
                <ResourceGrid>{globalCreds.map(renderCard)}</ResourceGrid>
              </section>
            )}
            {selectedCreds.length > 0 && (
              <section>
                <SectionHeader
                  title={t('components.credentialsSection.sections.scoped')}
                  description={t('components.credentialsSection.sections.scopedDesc')}
                />
                <ResourceGrid>{selectedCreds.map(renderCard)}</ResourceGrid>
              </section>
            )}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              {t('components.credentialsSection.dialogs.editTitle')}
            </DialogTitle>
          </DialogHeader>
          <CredentialFormFields form={form} setForm={setForm} errors={localizedErrors} isEditing />
          {generalError && <div className="mt-3 text-xs text-destructive">{generalError}</div>}
          <DialogFooter>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <SaveButton
              isSaving={upsertMutation.isPending}
              onClick={handleSave}
              label={t('common.update')}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

function WorkspaceScopeMeta({
  ids,
  byId,
}: {
  ids: string[]
  byId: Record<string, { name: string }>
}) {
  const names = ids.map((id) => byId[id]?.name ?? id)
  if (names.length === 0) return null
  const label = names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`
  return (
    <span title={names.join(', ')} className="truncate text-muted-foreground">
      {label}
    </span>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation()
  return (
    <EmptyHero
      className="min-h-[16rem]"
      illustration={<EmptyIllustration src="credentials" size="h-32" />}
      title={t('components.credentialsSection.empty.title')}
      description={t('components.credentialsSection.empty.description')}
      action={
        <Button type="button" size="sm" variant="outline" onClick={onCreate}>
          <Plus className="mr-1 h-3 w-3" />
          {t('components.credentialsSection.actions.new')}
        </Button>
      }
    />
  )
}

function InjectBadge({ inject }: { inject: string }) {
  const isEnv = inject === 'env'
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded px-1.5 font-mono text-tiny font-medium uppercase tracking-wide',
        isEnv ? 'bg-info/15 text-info' : 'bg-warning/15 text-warning',
      )}
    >
      {inject}
    </span>
  )
}
