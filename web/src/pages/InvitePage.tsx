import { Button } from '@/components/ui/button'
import { SaveButton } from '@/components/ui/save-button'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api/client'
import type { ApiTeamInvitePreview } from '@/lib/api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

/**
 * Landing page for team invite links. Renders a small confirmation card with
 * the team name, who invited the user, and a Join button. Idempotent: if the
 * caller already belongs to the team, the action becomes "Open team" instead.
 */
export function InvitePage() {
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const previewQuery = useQuery<ApiTeamInvitePreview>({
    queryKey: ['invite', token],
    queryFn: () => api.previewInvite(token!),
    enabled: !!token,
    retry: false,
  })

  const acceptMutation = useMutation({
    mutationFn: () => api.acceptInvite(token!),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      if (!data.already_member) {
        toast.success(t('pages.invitePage.toasts.joined'))
      }
      navigate('/', { replace: true })
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : t('pages.invitePage.errors.joinFailed')),
  })

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-sm ring-1 ring-foreground/5">
        {previewQuery.isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : previewQuery.error ? (
          <ErrorView error={previewQuery.error} />
        ) : previewQuery.data ? (
          <ReadyView
            preview={previewQuery.data}
            joining={acceptMutation.isPending}
            onJoin={() => acceptMutation.mutate()}
            onOpen={() => navigate('/', { replace: true })}
          />
        ) : null}
      </div>
    </div>
  )
}

function ReadyView({
  preview,
  joining,
  onJoin,
  onOpen,
}: {
  preview: ApiTeamInvitePreview
  joining: boolean
  onJoin: () => void
  onOpen: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-5 text-center">
      <div className="flex justify-center">
        <div className="relative inline-flex items-center justify-center">
          <div aria-hidden className="absolute h-24 w-24 rounded-full bg-primary/20 blur-3xl" />
          <Users className="relative h-12 w-12 text-primary/80" strokeWidth={1.25} />
        </div>
      </div>

      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{preview.team_name}</h1>
        {preview.inviter_name && (
          <p className="text-sm text-muted-foreground">
            {t('pages.invitePage.invitedBy', { name: preview.inviter_name })}
          </p>
        )}
        {preview.expires_at && (
          <p className="text-xs text-muted-foreground/70">
            {t('pages.invitePage.expiresAt', {
              value: new Date(preview.expires_at).toLocaleString(),
            })}
          </p>
        )}
      </div>

      {preview.already_member ? (
        <>
          <p className="text-sm text-muted-foreground">{t('pages.invitePage.alreadyMember')}</p>
          <Button type="button" variant="default" onClick={onOpen} className="w-full">
            {t('pages.invitePage.open')}
          </Button>
        </>
      ) : (
        <SaveButton
          type="button"
          isSaving={joining}
          onClick={onJoin}
          label={t('pages.invitePage.join')}
          className="w-full"
        />
      )}
    </div>
  )
}

function ErrorView({ error }: { error: unknown }) {
  const { t } = useTranslation()
  const raw = error instanceof Error ? error.message : ''
  const message = /expired/i.test(raw)
    ? t('pages.invitePage.errors.expired')
    : /not found/i.test(raw)
      ? t('pages.invitePage.errors.notFound')
      : raw || t('pages.invitePage.errors.loadFailed')

  return (
    <div className="space-y-4 text-center">
      <h1 className="text-lg font-semibold">{t('pages.invitePage.title')}</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
