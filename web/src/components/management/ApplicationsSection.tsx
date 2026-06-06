import ApplicationDialog from '@/components/dialogs/ApplicationDialog'
import { ResourceCard } from '@/components/resource/ResourceCard'
import { ResourceGrid } from '@/components/resource/ResourceGrid'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api/client'
import type { ApiApplication, ApiApplicationSecret } from '@/lib/api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Key, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const applicationsQueryKey = ['applications'] as const

export function ApplicationsSection(_: { instanceId: string }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const queryClient = useQueryClient()
  const headerSlot = useAppHeaderSlot()

  const applicationsQuery = useQuery<ApiApplication[]>({
    queryKey: applicationsQueryKey,
    queryFn: () => api.listApplications(),
  })
  const applications = applicationsQuery.data ?? []

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ApiApplication | null>(null)
  const [revealed, setRevealed] = useState<ApiApplicationSecret | null>(null)

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteApplication(id),
    onSuccess: () => {
      toast.success(t('components.management.applications.toasts.deleted'))
      queryClient.invalidateQueries({ queryKey: applicationsQueryKey })
    },
    onError: (err) => {
      toast.error(
        err instanceof Error
          ? err.message
          : t('components.management.applications.errors.deleteFailed'),
      )
    },
  })

  const rotateMutation = useMutation({
    mutationFn: (id: string) => api.rotateApplicationSecret(id),
    onSuccess: (result) => {
      // Surface the new secret in the same dialog used for create — same
      // visual treatment, single place to maintain.
      setEditing(null)
      setRevealed(result)
      setDialogOpen(true)
      toast.success(t('components.management.applications.toasts.rotated'))
      queryClient.invalidateQueries({ queryKey: applicationsQueryKey })
    },
    onError: (err) => {
      toast.error(
        err instanceof Error
          ? err.message
          : t('components.management.applications.errors.rotateFailed'),
      )
    },
  })

  const deletingId = deleteMutation.isPending ? (deleteMutation.variables ?? null) : null
  const rotatingId = rotateMutation.isPending ? (rotateMutation.variables ?? null) : null

  function openCreate() {
    setEditing(null)
    setRevealed(null)
    setDialogOpen(true)
  }

  function openEdit(app: ApiApplication) {
    setEditing(app)
    setRevealed(null)
    setDialogOpen(true)
  }

  return (
    <>
      {headerSlot &&
        isAdmin &&
        createPortal(
          <AppHeaderButton
            icon={Plus}
            label={t('components.management.applications.actions.new')}
            onClick={openCreate}
          />,
          headerSlot,
        )}

      <div className="h-full overflow-y-auto p-4">
        {applications.length === 0 ? (
          <EmptyState onCreate={isAdmin ? openCreate : undefined} />
        ) : (
          <ResourceGrid>
            {applications.map((app) => {
              const ownerLabel =
                app.owner_display_name ??
                app.owner_username ??
                t('components.management.applications.labels.unknownOwner')
              const created = new Date(app.created_at).toLocaleDateString()
              return (
                <ResourceCard
                  key={app.id}
                  name={
                    app.homepage_url ? (
                      <a
                        href={app.homepage_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 hover:underline"
                        title={t('components.management.applications.actions.visitHomepage')}
                      >
                        {app.name}
                        <ExternalLink className="h-3 w-3 opacity-60" />
                      </a>
                    ) : (
                      app.name
                    )
                  }
                  description={app.description || undefined}
                  type={<ClientIdChip id={app.id} />}
                  meta={`${t('components.management.applications.labels.createdAt', { value: created })} · ${ownerLabel}`}
                  actions={
                    isAdmin && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          onClick={() => openEdit(app)}
                          title={t('components.management.applications.actions.edit')}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        {rotatingId === app.id ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            disabled
                          >
                            <Spinner size="sm" className="h-3 w-3" />
                          </Button>
                        ) : (
                          <ConfirmButton
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground"
                            disabled={rotatingId !== null}
                            onConfirm={() => rotateMutation.mutate(app.id)}
                            icon={<Key className="h-3 w-3" />}
                            tooltip={t('components.management.applications.actions.rotate')}
                          />
                        )}
                        {deletingId === app.id ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
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
                            disabled={deletingId !== null}
                            onConfirm={() => deleteMutation.mutate(app.id)}
                            icon={<Trash2 className="h-3 w-3" />}
                            tooltip={t('components.management.applications.actions.delete')}
                          />
                        )}
                      </>
                    )
                  }
                />
              )
            })}
          </ResourceGrid>
        )}
      </div>

      <ApplicationDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          setDialogOpen(v)
          if (!v) setRevealed(null)
        }}
        application={editing}
        revealed={revealed}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: applicationsQueryKey })
        }}
      />
    </>
  )
}

function ClientIdChip({ id }: { id: string }) {
  return (
    <code className="inline-flex h-5 items-center rounded bg-foreground/[0.06] px-1.5 font-mono text-tiny tracking-tight">
      {id}
    </code>
  )
}

function EmptyState({ onCreate }: { onCreate?: () => void }) {
  const { t } = useTranslation()
  return (
    <EmptyHero
      className="min-h-[16rem]"
      illustration={<EmptyIllustration src="applications" size="h-32" />}
      title={t('components.management.applications.empty.noApplications.title')}
      description={t('components.management.applications.empty.noApplications.description')}
      action={
        onCreate && (
          <Button type="button" size="sm" variant="outline" onClick={onCreate}>
            <Plus className="mr-1 h-3 w-3" />
            {t('components.management.applications.actions.new')}
          </Button>
        )
      }
    />
  )
}
