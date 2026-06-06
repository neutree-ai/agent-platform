import { ResourceCard } from '@/components/resource/ResourceCard'
import { ResourceGrid } from '@/components/resource/ResourceGrid'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import { Spinner } from '@/components/ui/spinner'
import { useDialogStack } from '@/contexts/DialogStackContext'
import { api } from '@/lib/api/client'
import type { ApiServiceToken } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const serviceTokensQueryKey = ['service-tokens'] as const

export function ServiceTokensSection(_: { instanceId: string }) {
  const { t } = useTranslation()
  const { open: openDialog } = useDialogStack()
  const queryClient = useQueryClient()
  const headerSlot = useAppHeaderSlot()

  const { data: tokens = [] } = useQuery<ApiServiceToken[]>({
    queryKey: serviceTokensQueryKey,
    queryFn: () => api.listServiceTokens(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteServiceToken(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serviceTokensQueryKey })
    },
  })

  const deletingId = deleteMutation.isPending ? (deleteMutation.variables ?? null) : null

  function openCreate() {
    openDialog('create-token')
  }

  async function handleDelete(id: string) {
    try {
      await deleteMutation.mutateAsync(id)
      toast.success(t('components.management.serviceTokens.toasts.revoked'))
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t('components.management.serviceTokens.errors.revokeFailed'),
      )
    }
  }

  return (
    <>
      {headerSlot &&
        createPortal(
          <AppHeaderButton
            icon={Plus}
            label={t('components.management.serviceTokens.actions.new')}
            onClick={openCreate}
          />,
          headerSlot,
        )}

      <div className="h-full overflow-y-auto p-4">
        {tokens.length === 0 ? (
          <EmptyState onCreate={openCreate} />
        ) : (
          <ResourceGrid>
            {tokens.map((token) => {
              const created = new Date(token.created_at).toLocaleDateString()
              return (
                <ResourceCard
                  key={token.id}
                  name={
                    token.is_platform
                      ? t('components.management.serviceTokens.labels.platformToken')
                      : token.name
                  }
                  description={
                    token.is_platform
                      ? t('components.management.serviceTokens.labels.platformDescription')
                      : undefined
                  }
                  type={<KindBadge kind={token.is_platform ? 'system' : 'user'} />}
                  meta={
                    token.is_platform
                      ? undefined
                      : t('components.management.serviceTokens.labels.createdAt', {
                          value: created,
                        }) + (token.created_by ? ` · ${token.created_by}` : '')
                  }
                  actions={
                    !token.is_platform &&
                    (deletingId === token.id ? (
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
                        onConfirm={() => handleDelete(token.id)}
                        icon={<Trash2 className="h-3 w-3" />}
                        tooltip={t('components.management.serviceTokens.actions.revoke')}
                      />
                    ))
                  }
                />
              )
            })}
          </ResourceGrid>
        )}
      </div>
    </>
  )
}

function KindBadge({ kind }: { kind: 'system' | 'user' }) {
  const { t } = useTranslation()
  const isSystem = kind === 'system'
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded px-1.5 font-mono text-tiny font-medium uppercase tracking-wide',
        isSystem ? 'bg-info/15 text-info' : 'bg-foreground/[0.08] text-muted-foreground',
      )}
    >
      {t(`components.management.serviceTokens.labels.${kind}`)}
    </span>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation()
  return (
    <EmptyHero
      className="min-h-[16rem]"
      illustration={<EmptyIllustration src="service-tokens" size="h-32" />}
      title={t('components.management.serviceTokens.empty.noTokens.title')}
      description={t('components.management.serviceTokens.empty.noTokens.description')}
      action={
        <Button type="button" size="sm" variant="outline" onClick={onCreate}>
          <Plus className="mr-1 h-3 w-3" />
          {t('components.management.serviceTokens.actions.new')}
        </Button>
      }
    />
  )
}
