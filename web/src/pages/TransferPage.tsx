import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SaveButton } from '@/components/ui/save-button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { TransferPlanView } from '@/components/workspace/transfer/TransferPlanView'
import { useAuth } from '@/contexts/AuthContext'
import { useProviders } from '@/hooks/useProviders'
import { api } from '@/lib/api/client'
import type { ApiTransferPlan, ApiWorkspaceTransfer, TransferStatus } from '@/lib/api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

const STATUS_LABEL: Record<TransferStatus, string> = {
  pending: 'pages.transferPage.status.pending',
  executing: 'pages.transferPage.status.executing',
  completed: 'pages.transferPage.status.completed',
  declined: 'pages.transferPage.status.declined',
  cancelled: 'pages.transferPage.status.cancelled',
  expired: 'pages.transferPage.status.expired',
  failed: 'pages.transferPage.status.failed',
}

/**
 * Landing page for a workspace transfer, linked from the notification the
 * recipient receives. Shows what accepting would do, collects what the
 * recipient must supply (a new slug on a clash, their own provider when the
 * sender's is private), and accepts or declines. The sender sees the same
 * page read-only.
 */
export function TransferPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()

  const query = useQuery({
    queryKey: ['transfer', id],
    queryFn: () => api.getTransfer(id!),
    enabled: !!id,
    retry: false,
  })

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg rounded-2xl bg-card p-8 shadow-sm ring-1 ring-foreground/5">
        {query.isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : query.error || !query.data ? (
          <div className="space-y-4 text-center">
            <h1 className="text-lg font-semibold">{t('pages.transferPage.title')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('pages.transferPage.errors.notFound')}
            </p>
          </div>
        ) : (
          <TransferView transfer={query.data.transfer} plan={query.data.plan} />
        )}
      </div>
    </div>
  )
}

function TransferView({
  transfer,
  plan,
}: {
  transfer: ApiWorkspaceTransfer
  plan: ApiTransferPlan | null
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const isRecipient = user?.id === transfer.to_user.id

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="relative inline-flex items-center justify-center">
          <div aria-hidden className="absolute h-24 w-24 rounded-full bg-primary/20 blur-3xl" />
          <ArrowRightLeft className="relative h-10 w-10 text-primary/80" strokeWidth={1.25} />
        </div>
        <h1 className="text-lg font-semibold">{transfer.workspace_name}</h1>
        <p className="text-sm text-muted-foreground">
          {t('pages.transferPage.offeredBy', { name: transfer.from_user.display_name })}
        </p>
      </div>

      {transfer.status !== 'pending' || !plan ? (
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-sm text-muted-foreground">{t(STATUS_LABEL[transfer.status])}</p>
          {transfer.status === 'completed' && isRecipient && (
            <Button onClick={() => navigate(`/w/${transfer.workspace_id}`, { replace: true })}>
              {t('pages.transferPage.openWorkspace')}
            </Button>
          )}
        </div>
      ) : isRecipient ? (
        <AcceptForm transfer={transfer} plan={plan} />
      ) : (
        <>
          <PlanBox plan={plan} />
          <p className="text-center text-sm text-muted-foreground">
            {t('pages.transferPage.waiting', {
              name: transfer.to_user.display_name,
              date: new Date(transfer.expires_at).toLocaleDateString(),
            })}
          </p>
        </>
      )}
    </div>
  )
}

function PlanBox({ plan }: { plan: ApiTransferPlan }) {
  return (
    <div className="max-h-80 overflow-y-auto rounded-md border border-border/60 p-3">
      <TransferPlanView plan={plan} />
    </div>
  )
}

function AcceptForm({
  transfer,
  plan,
}: {
  transfer: ApiWorkspaceTransfer
  plan: ApiTransferPlan
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: providers } = useProviders()
  const [slug, setSlug] = useState(plan.suggested_slug ?? '')
  const [providerId, setProviderId] = useState('')

  const acceptMutation = useMutation({
    mutationFn: () =>
      api.acceptTransfer(transfer.id, {
        slug: plan.slug_conflict ? slug.trim() : undefined,
        provider_id: plan.provider_required ? providerId : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      toast.success(t('pages.transferPage.toasts.accepted'))
      navigate(`/w/${transfer.workspace_id}`, { replace: true })
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : t('pages.transferPage.errors.accept')),
  })

  const declineMutation = useMutation({
    mutationFn: () => api.declineTransfer(transfer.id),
    onSuccess: () => {
      toast.success(t('pages.transferPage.toasts.declined'))
      navigate('/', { replace: true })
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : t('pages.transferPage.errors.decline')),
  })

  const ready =
    !plan.blocked &&
    (!plan.slug_conflict || !!slug.trim()) &&
    (!plan.provider_required || !!providerId)
  const busy = acceptMutation.isPending || declineMutation.isPending

  return (
    <div className="flex flex-col gap-4">
      <PlanBox plan={plan} />

      {plan.slug_conflict && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">
            {t('pages.transferPage.slug.label', { slug: plan.workspace.slug })}
          </Label>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
      )}

      {plan.provider_required && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">
            {t('pages.transferPage.provider.label')}
          </Label>
          <Select value={providerId} onValueChange={setProviderId}>
            <SelectTrigger className="text-sm">
              <SelectValue placeholder={t('pages.transferPage.provider.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {(providers ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {providers && providers.length === 0 && (
            <p className="text-mini text-muted-foreground">
              {t('pages.transferPage.provider.none')}
            </p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={busy}
          onClick={() => declineMutation.mutate()}
        >
          {t('pages.transferPage.decline')}
        </Button>
        <SaveButton
          type="button"
          className="flex-1"
          isSaving={acceptMutation.isPending}
          disabled={!ready || busy}
          onClick={() => acceptMutation.mutate()}
          label={t('pages.transferPage.accept')}
        />
      </div>
    </div>
  )
}
