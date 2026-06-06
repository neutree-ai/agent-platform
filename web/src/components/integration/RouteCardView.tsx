import { WEBHOOK_CONNECTOR_TYPES } from '@/components/IntegrationPage'
import { ResourceCard } from '@/components/resource/ResourceCard'
import { KVKey, KVValue } from '@/components/ui/key-value'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cgApi } from '@/lib/api/channel-gateway'
import { cn } from '@/lib/utils'
import { AlertTriangle, CircleHelp, Copy, Loader2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/** Self-contained secret reveal pill. Fetches on first click, copies on second. */
function SecretPill({ routeId }: { routeId: string }) {
  const { t } = useTranslation()
  const [value, setValue] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleClick = async () => {
    if (value !== null) {
      if (value) {
        navigator.clipboard.writeText(value)
        toast.success(t('components.integration.routeCardView.toasts.copied'))
      } else setValue(null)
      return
    }
    setLoading(true)
    try {
      const data = await cgApi.getRouteSecret(routeId)
      setValue(data.secret || '')
    } catch {
      toast.error(t('components.integration.routeCardView.errors.loadSecretFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded bg-foreground/[0.06] px-2 py-1 text-tiny font-mono text-muted-foreground hover:bg-foreground/[0.10] transition-colors"
      disabled={loading}
      onClick={handleClick}
    >
      <span>
        {loading
          ? t('components.integration.routeCardView.secret.loading')
          : value !== null
            ? value || t('components.integration.routeCardView.secret.notSet')
            : '••••••••'}
      </span>
      {value === null && !loading && (
        <span className="text-mini text-muted-foreground/60">
          {t('components.integration.routeCardView.secret.clickToReveal')}
        </span>
      )}
      {value !== null && value && <Copy className="h-3 w-3" />}
    </button>
  )
}

interface RouteCardViewProps {
  id: string
  name: string
  workspaceName?: string
  workspaceId?: string
  externalId: string
  externalLabel?: string
  externalLabelStatus?: 'loading' | 'missing' | 'error'
  externalLabelStatusText?: string
  /** Localized label for the external_id field (e.g. "Channel ID", "Group", "Endpoint"). */
  externalIdLabel?: string
  /** Localized label for the resolved external label row (e.g. "Channel"). */
  externalLabelKey?: string
  connectorType: string
  connectorId?: string
  webhookBaseUrl?: string
  relayPublicUrl?: string
  enabled?: boolean
  actions?: ReactNode
}

export function RouteCardView({
  id,
  name,
  workspaceName,
  workspaceId,
  externalId,
  externalLabel,
  externalLabelStatus,
  externalLabelStatusText,
  externalIdLabel,
  externalLabelKey,
  connectorType,
  connectorId,
  webhookBaseUrl,
  relayPublicUrl,
  enabled = true,
  actions,
}: RouteCardViewProps) {
  const { t } = useTranslation()
  const isWebhook = WEBHOOK_CONNECTOR_TYPES.has(connectorType)
  const baseUrl = connectorType === 'webhook-relay' ? relayPublicUrl : webhookBaseUrl
  const webhookUrl =
    isWebhook && connectorId && baseUrl ? `${baseUrl}/webhook/${connectorId}${externalId}` : null
  const showExternalLabel = externalLabel && externalLabel !== externalId

  const workspaceMeta = workspaceName ? (
    <span>→ {workspaceName}</span>
  ) : workspaceId ? (
    <span className="font-mono">→ {workspaceId}</span>
  ) : null

  const body = isWebhook ? (
    <div className="space-y-1.5">
      {webhookUrl && (
        <div className="flex items-center gap-1.5 rounded bg-foreground/[0.06] px-2 py-1.5">
          <span
            className="flex-1 truncate font-mono text-tiny text-muted-foreground"
            title={webhookUrl}
          >
            {webhookUrl}
          </span>
          <button
            type="button"
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => {
              navigator.clipboard.writeText(webhookUrl)
              toast.success(t('components.integration.routeCardView.toasts.copied'))
            }}
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      )}
      <SecretPill routeId={id} />
    </div>
  ) : (
    // CSS grid auto-sizes the key column to its widest sibling per card,
    // so "Group Chat ID" / "Endpoint Path" / "ID" all align without
    // hardcoded widths or truncation.
    <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-xs">
      {externalLabelStatus === 'loading' ? (
        <>
          <KVKey>
            {externalLabelKey ?? t('components.integration.routeCardView.fields.target')}
          </KVKey>
          <KVValue>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {externalLabelStatusText}
            </span>
          </KVValue>
        </>
      ) : (
        showExternalLabel && (
          <>
            <KVKey>
              {externalLabelKey ?? t('components.integration.routeCardView.fields.target')}
            </KVKey>
            <KVValue>
              <span className="truncate text-foreground">{externalLabel}</span>
              {(externalLabelStatus === 'missing' || externalLabelStatus === 'error') && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="ml-1 shrink-0">
                        {externalLabelStatus === 'error' ? (
                          <AlertTriangle className="h-3 w-3 text-warning" />
                        ) : (
                          <CircleHelp className="h-3 w-3 text-muted-foreground" />
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{externalLabelStatusText}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </KVValue>
          </>
        )
      )}
      <KVKey>{externalIdLabel ?? t('components.integration.routeCardView.fields.id')}</KVKey>
      <KVValue>
        <span className="truncate font-mono text-muted-foreground" title={externalId}>
          {externalId}
        </span>
      </KVValue>
    </dl>
  )

  return (
    <ResourceCard
      name={name || externalId}
      meta={workspaceMeta}
      body={body}
      actions={actions}
      className={cn(!enabled && 'opacity-60')}
    />
  )
}
