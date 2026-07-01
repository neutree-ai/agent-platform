import {
  type EnvironmentForm,
  type EnvironmentFormErrors,
  EnvironmentFormFields,
  validateEnvironmentForm,
} from '@/components/dialogs/EnvironmentFormFields'
import { SecretReveal } from '@/components/dialogs/SecretReveal'
import { ResourceCard } from '@/components/resource/ResourceCard'
import { ResourceFilterTabs, type ScopeFilter } from '@/components/resource/ResourceFilterTabs'
import { ResourceGrid } from '@/components/resource/ResourceGrid'
import type { ResourceScope } from '@/components/resource/ScopeBadge'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import { Input } from '@/components/ui/input'
import { SaveButton } from '@/components/ui/save-button'
import { Spinner } from '@/components/ui/spinner'
import { useDialogStack } from '@/contexts/DialogStackContext'
import {
  useCreateEnvironmentToken,
  useDeleteEnvironment,
  useEnvironmentGrants,
  useEnvironmentTokens,
  useEnvironments,
  useRevokeEnvironmentToken,
  useUpdateEnvironment,
} from '@/hooks/useEnvironments'
import type { ApiEnvironment } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { Brain, FolderSymlink, KeyRound, type LucideIcon, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

const INITIAL_FORM: EnvironmentForm = {
  name: '',
  visibility: 'private',
  team_ids: [],
}

/** Map the runner-reported status string to a dot tone. */
function statusTone(status: string): string {
  switch (status) {
    case 'online':
      return 'bg-success'
    case 'degraded':
      return 'bg-warning'
    case 'offline':
      return 'bg-destructive/60'
    default:
      return 'bg-muted-foreground/30'
  }
}

export function EnvironmentsSection({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation()
  const { open: openDialog } = useDialogStack()
  const { data: environments = [] } = useEnvironments()
  const updateEnvironment = useUpdateEnvironment()
  const deleteEnvironment = useDeleteEnvironment()
  const headerSlot = useAppHeaderSlot()

  const [scopeFilter, setScopeFilter] = useInstancePersistentState<ScopeFilter>(
    instanceId,
    'scopeFilter',
    () => 'all',
  )

  const counts = useMemo(() => {
    const c: Partial<Record<ScopeFilter, number>> = {
      all: environments.length,
      private: 0,
      team: 0,
      public: 0,
    }
    for (const e of environments) {
      if (e.visibility === 'public') c.public = (c.public ?? 0) + 1
      else if (e.visibility === 'team') c.team = (c.team ?? 0) + 1
      else c.private = (c.private ?? 0) + 1
    }
    return c
  }, [environments])

  const filtered = useMemo(() => {
    if (scopeFilter === 'all') return environments
    return environments.filter((e) => e.visibility === scopeFilter)
  }, [environments, scopeFilter])

  const [errors, setErrors] = useState<EnvironmentFormErrors>({})
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<EnvironmentForm>(INITIAL_FORM)
  const [tokensFor, setTokensFor] = useState<ApiEnvironment | null>(null)

  // Pre-load existing grants when editing a team-shared environment.
  const { data: editGrants } = useEnvironmentGrants(
    editingId ?? '',
    editOpen && !!editingId && form.visibility === 'team',
  )
  useEffect(() => {
    if (editGrants) setForm((f) => ({ ...f, team_ids: editGrants.map((g) => g.team_id) }))
  }, [editGrants])

  function openCreate() {
    openDialog('create-environment')
  }

  function openEdit(e: ApiEnvironment) {
    setForm({ name: e.name, visibility: e.visibility, team_ids: [] })
    setEditingId(e.id)
    setErrors({})
    setGeneralError(null)
    setEditOpen(true)
  }

  async function handleSave() {
    const next = validateEnvironmentForm(form)
    setErrors(next)
    if (Object.keys(next).length > 0) return
    if (!editingId) return
    setGeneralError(null)
    const { team_ids, visibility, name } = form
    try {
      await updateEnvironment.mutateAsync({
        id: editingId,
        data: {
          name: name.trim(),
          visibility,
          grants:
            visibility === 'team'
              ? team_ids.map((team_id) => ({ team_id, permission: 'viewer' as const }))
              : [],
        },
      })
      setEditOpen(false)
    } catch (err) {
      setGeneralError(
        err instanceof Error
          ? err.message
          : t('components.management.environments.errors.saveFailed'),
      )
    }
  }

  const localizedErrors: EnvironmentFormErrors = {
    name: errors.name ? t(errors.name) : undefined,
    teams: errors.teams ? t(errors.teams) : undefined,
  }

  return (
    <>
      {headerSlot &&
        createPortal(
          <>
            <AppHeaderButton
              icon={Plus}
              label={t('components.management.environments.actions.new')}
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
          {environments.length === 0 ? (
            <EmptyState onCreate={openCreate} />
          ) : filtered.length === 0 ? (
            <FilterEmptyState />
          ) : (
            <ResourceGrid>
              {filtered.map((e) => {
                const scope: ResourceScope = e.visibility
                return (
                  <ResourceCard
                    key={e.id}
                    name={
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex h-1.5 w-1.5 shrink-0 rounded-full',
                            statusTone(e.status),
                          )}
                        />
                        <span className="min-w-0 truncate">{e.name}</span>
                        {e.is_builtin && (
                          <Badge
                            variant="outline"
                            className="shrink-0 px-1.5 py-0 text-tiny font-normal"
                          >
                            {t('components.management.environments.labels.builtin')}
                          </Badge>
                        )}
                      </span>
                    }
                    // Consistent across every card: liveness · provisioning kind.
                    // Advertised capabilities render as their own chips (body).
                    type={t(`components.management.environments.status.${e.status}`, e.status)}
                    meta={e.kind}
                    body={<CapabilityChips env={e} />}
                    scope={scope}
                    owned={e.is_own && !e.is_builtin}
                    actions={
                      e.is_own &&
                      !e.is_builtin && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            onClick={() => setTokensFor(e)}
                            aria-label={t('components.management.environments.actions.tokens')}
                            title={t('components.management.environments.actions.tokens')}
                          >
                            <KeyRound className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            onClick={() => openEdit(e)}
                            aria-label={t('components.management.environments.actions.edit')}
                            title={t('components.management.environments.actions.edit')}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <ConfirmButton
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            disabled={deleteEnvironment.isPending}
                            onConfirm={() => deleteEnvironment.mutate(e.id)}
                            icon={<Trash2 className="h-3 w-3" />}
                            tooltip={t('components.management.environments.actions.delete')}
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
        open={editOpen}
        onOpenChange={setEditOpen}
        title={t('components.management.environments.dialogs.editTitle')}
        footer={
          <>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditOpen(false)}>
              {t('common.cancel')}
            </Button>
            <SaveButton
              isSaving={updateEnvironment.isPending}
              onClick={handleSave}
              label={t('common.update')}
            />
          </>
        }
      >
        <EnvironmentFormFields form={form} setForm={setForm} errors={localizedErrors} />
        {generalError && <div className="mt-3 text-xs text-destructive">{generalError}</div>}
      </DocumentedDialog>

      <ManageTokensDialog env={tokensFor} onOpenChange={(open) => !open && setTokensFor(null)} />
    </>
  )
}

// The capabilities a k8s environment actually advertises today (sharedFs via
// afs, persistentMemory via memory-fuse). Rendered as chips so the card's meta
// line can stay a consistent status · kind.
const CAPABILITY_CHIPS: {
  key: 'sharedFs' | 'persistentMemory'
  label: string
  Icon: LucideIcon
}[] = [
  { key: 'sharedFs', label: 'afs', Icon: FolderSymlink },
  { key: 'persistentMemory', label: 'memory', Icon: Brain },
]

/** Chips for the advertised capabilities (only truthy ones); null when none. */
function CapabilityChips({ env }: { env: ApiEnvironment }) {
  const caps = env.capabilities ?? {}
  const present = CAPABILITY_CHIPS.filter((c) => caps[c.key])
  if (present.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      {present.map(({ key, label, Icon }) => (
        <Badge key={key} variant="muted-soft" className="gap-1 px-2 py-0 text-tiny font-normal">
          <Icon className="h-3 w-3 shrink-0" strokeWidth={2} />
          {label}
        </Badge>
      ))}
    </div>
  )
}

function ManageTokensDialog({
  env,
  onOpenChange,
}: {
  env: ApiEnvironment | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const open = env !== null
  const envId = env?.id ?? ''
  const { data: tokens = [] } = useEnvironmentTokens(envId, open)
  const createToken = useCreateEnvironmentToken()
  const revokeToken = useRevokeEnvironmentToken()
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setFresh(null)
    }
  }, [open])

  async function handleIssue() {
    if (!name.trim() || !envId) return
    const token = await createToken.mutateAsync({ id: envId, name: name.trim() })
    setFresh(token.token)
    setName('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('components.management.environments.tokens.title', { name: env?.name ?? '' })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {fresh && <SecretReveal value={fresh} />}

          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Input
                className="h-9 text-sm"
                placeholder={t('components.management.environments.tokens.namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <SaveButton
              isSaving={createToken.isPending}
              onClick={handleIssue}
              label={t('components.management.environments.tokens.issue')}
            />
          </div>

          <div className="space-y-1.5">
            {tokens.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                {t('components.management.environments.tokens.empty')}
              </div>
            ) : (
              tokens.map((tk) => (
                <div
                  key={tk.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-2.5 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{tk.name}</div>
                    <div className="text-tiny text-muted-foreground">
                      {t('components.management.environments.tokens.createdAt', {
                        value: new Date(tk.created_at).toLocaleDateString(),
                      })}
                    </div>
                  </div>
                  {revokeToken.isPending && revokeToken.variables?.tokenId === tk.id ? (
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
                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={revokeToken.isPending}
                      onConfirm={() => revokeToken.mutate({ id: envId, tokenId: tk.id })}
                      icon={<Trash2 className="h-3 w-3" />}
                      tooltip={t('components.management.environments.tokens.revoke')}
                    />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation()
  return (
    <EmptyHero
      className="min-h-[16rem]"
      illustration={<EmptyIllustration src="connectors" size="h-32" />}
      title={t('components.management.environments.empty.noEnvironments.title')}
      description={t('components.management.environments.empty.noEnvironments.description')}
      action={
        <Button type="button" size="sm" variant="outline" onClick={onCreate}>
          <Plus className="mr-1 h-3 w-3" />
          {t('components.management.environments.actions.new')}
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
