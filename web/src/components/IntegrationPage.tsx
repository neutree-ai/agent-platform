import { Button } from '@/components/ui/button'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { PromptField } from '@/components/workspace/PromptField'
import {
  type ConnectorType as PresetConnectorType,
  listPromptPresets,
} from '@/docs/route-prompt-presets/_load'
import { type CgConnector, type CgRoute, cgApi } from '@/lib/api/channel-gateway'
import type { Workspace } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Eye, EyeOff, Plus, Trash2, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

// ─── Connector Type Config Registry ────────────────────────────────

interface CredentialField {
  key: string
  label: string
  placeholder: string
  required: boolean
  helpText?: string
  sensitive?: boolean // default true — set false for non-secret fields like header names
  generatable?: boolean // show a Generate button to auto-fill with a random value
  options?: { value: string; label: string }[] // render as select instead of input
}

interface ConnectorTypeConfig {
  label: string
  credentialFields: CredentialField[]
  testable: boolean
  externalId?: ExternalIdConfig
}

interface ExternalIdConfig {
  label: string
  placeholder: string
  helpText?: string
}

export const CONNECTOR_TYPES: Record<string, ConnectorTypeConfig> = {
  slack: {
    label: 'Slack',
    testable: true,
    credentialFields: [
      {
        key: 'bot_token',
        label: 'Bot Token',
        placeholder: 'xoxb-...',
        required: true,
        helpText: 'Slack App → OAuth & Permissions → Bot User OAuth Token',
      },
      {
        key: 'app_token',
        label: 'App Token',
        placeholder: 'xapp-...',
        required: true,
        helpText: 'Slack App → Basic Information → App-Level Tokens (connections:write scope)',
      },
    ],
    externalId: {
      label: 'Channel ID',
      placeholder: 'C0XXXXXXXXX',
      helpText: 'Slack channel ID (starts with C)',
    },
  },
  wecom: {
    label: 'WeCom',
    testable: false,
    credentialFields: [
      {
        key: 'bot_id',
        label: 'Bot ID',
        placeholder: 'aibXXX...',
        required: true,
        sensitive: false,
        helpText:
          'WeCom admin console -> Security and Management -> Management Tools -> Intelligent Robot -> Bot ID',
      },
      {
        key: 'secret',
        label: 'Secret',
        placeholder: '',
        required: true,
        helpText: 'Long-connection secret of the intelligent robot (not app corpsecret)',
      },
    ],
    externalId: {
      label: 'Group Chat ID',
      placeholder: 'wrXXX...',
      helpText: 'WeCom group chat ID, available from the chatid field in incoming messages',
    },
  },
  webhook: {
    label: 'Webhook',
    testable: false,
    credentialFields: [],
    externalId: { label: 'Endpoint Path', placeholder: '/my-hook' },
  },
  'webhook-relay': {
    label: 'Webhook Relay',
    testable: false,
    credentialFields: [
      {
        key: 'queue_url',
        label: 'Queue URL',
        placeholder: 'https://sqs.ap-east-1.amazonaws.com/123456789/nap-webhook-relay',
        required: true,
        sensitive: false,
        helpText: 'SQS Queue URL',
      },
      {
        key: 'region',
        label: 'Region',
        placeholder: 'ap-east-1',
        required: true,
        sensitive: false,
        helpText: 'AWS region of the SQS queue',
      },
      {
        key: 'access_key_id',
        label: 'Access Key ID',
        placeholder: '',
        required: false,
        helpText: 'Leave empty to use IAM role or default credential chain',
      },
      {
        key: 'secret_access_key',
        label: 'Secret Access Key',
        placeholder: '',
        required: false,
        helpText: 'Leave empty to use IAM role or default credential chain',
      },
    ],
    externalId: { label: 'Endpoint Path', placeholder: '/my-hook' },
  },
}

const DEFAULT_EXTERNAL_ID: ExternalIdConfig = { label: 'External ID', placeholder: '' }

/** Connector types that use webhook-style ingestion (HTTP POST with body/headers). */
export const WEBHOOK_CONNECTOR_TYPES = new Set(['webhook', 'webhook-relay'])

// ─── Connector Form ─────────────────────────────────────────────────

export function ConnectorForm({
  initial,
  onSubmit,
  onCancel,
  loading,
  onTest,
  testing,
  onTypeChange,
}: {
  initial?: Partial<CgConnector>
  onSubmit: (data: {
    type: string
    name: string
    credentials?: Record<string, unknown>
    config?: Record<string, unknown>
    is_public?: boolean
  }) => void
  onCancel: () => void
  loading: boolean
  onTest?: () => void
  testing?: boolean
  onTypeChange?: (type: string) => void
}) {
  const { t } = useTranslation()
  const [type, setType] = useState(() => {
    const t = initial?.type ?? 'slack'
    onTypeChange?.(t)
    return t
  })
  const [name, setName] = useState(initial?.name ?? '')
  const [creds, setCreds] = useState<Record<string, string>>({})
  const [credsRevealed, setCredsRevealed] = useState(false)
  const [credsLoading, setCredsLoading] = useState(false)
  const [isPublic, setIsPublic] = useState(initial?.is_public ?? false)
  const [relayPublicUrl, setRelayPublicUrl] = useState(
    (initial?.config?.relay_public_url as string) ?? '',
  )

  const isEdit = !!initial
  const typeConfig = CONNECTOR_TYPES[type]
  const fields =
    typeConfig?.credentialFields.map((field) => ({
      ...field,
      label: t(`components.integration.typeConfigs.${type}.credentials.${field.key}.label`),
      placeholder: t(
        `components.integration.typeConfigs.${type}.credentials.${field.key}.placeholder`,
      ),
      helpText: field.helpText
        ? t(`components.integration.typeConfigs.${type}.credentials.${field.key}.helpText`)
        : undefined,
    })) ?? []
  const revealCredentials = async () => {
    if (!initial?.id) return
    setCredsLoading(true)
    try {
      const data = await cgApi.getConnectorCredentials(initial.id)
      const mapped: Record<string, string> = {}
      for (const [k, v] of Object.entries(data)) {
        mapped[k] = String(v ?? '')
      }
      setCreds(mapped)
      setCredsRevealed(true)
    } catch {
      toast.error(t('components.integration.connector.toasts.loadCredentialsFailed'))
    } finally {
      setCredsLoading(false)
    }
  }

  const canSubmit =
    name.trim() && (isEdit || fields.every((f) => !f.required || creds[f.key]?.trim()))

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const data: Parameters<typeof onSubmit>[0] = { type, name, is_public: isPublic }
        // Only include non-empty credential values
        const filledCreds = Object.fromEntries(Object.entries(creds).filter(([, v]) => v.trim()))
        if (Object.keys(filledCreds).length > 0) data.credentials = filledCreds
        // Include config for webhook-relay
        if (type === 'webhook-relay' && relayPublicUrl.trim()) {
          data.config = { relay_public_url: relayPublicUrl.trim() }
        }
        onSubmit(data)
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="type" className="text-sm font-medium">
          {t('components.integration.connector.fields.type')}
        </Label>
        <Select
          value={type}
          onValueChange={(v) => {
            setType(v)
            setCreds({})
            onTypeChange?.(v)
          }}
          disabled={isEdit}
        >
          <SelectTrigger id="type" className="h-9 text-sm focus:ring-inset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(CONNECTOR_TYPES).map((key) => (
              <SelectItem key={key} value={key} className="py-2">
                {t(`components.integration.typeConfigs.${key}.label`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="name" className="text-sm font-medium">
          {t('components.integration.connector.fields.name')}
        </Label>
        <Input
          id="name"
          className="h-9 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      {isEdit && fields.length > 0 && !credsRevealed && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={revealCredentials}
          disabled={credsLoading}
        >
          {credsLoading ? (
            <>
              <Spinner size="sm" className="mr-1.5 h-3 w-3" /> {t('common.loading')}
            </>
          ) : (
            <>
              <Eye className="mr-1.5 h-3 w-3" />{' '}
              {t('components.integration.connector.actions.showCredentials')}
            </>
          )}
        </Button>
      )}
      {isEdit && fields.length > 0 && credsRevealed && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => {
            setCreds({})
            setCredsRevealed(false)
          }}
        >
          <EyeOff className="mr-1.5 h-3 w-3" />{' '}
          {t('components.integration.connector.actions.hideCredentials')}
        </Button>
      )}
      {fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <Label htmlFor={field.key} className="text-sm font-medium">
            {field.label}
            {isEdit && !credsRevealed
              ? t('components.integration.shared.keepExisting')
              : field.required
                ? ''
                : t('components.integration.shared.optional')}
          </Label>
          {field.options ? (
            <Select
              value={creds[field.key] ?? field.options[0]?.value ?? ''}
              onValueChange={(v) => setCreds((prev) => ({ ...prev, [field.key]: v }))}
            >
              <SelectTrigger id={field.key} className="h-9 text-sm focus:ring-inset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {field.options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="py-2">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex gap-1.5">
              <Input
                id={field.key}
                type={field.sensitive === false ? 'text' : creds[field.key] ? 'text' : 'password'}
                value={creds[field.key] ?? ''}
                onChange={(e) => setCreds((prev) => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                className="h-9 flex-1 text-sm"
              />
              {field.generatable && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 text-xs"
                  onClick={() => {
                    const bytes = crypto.getRandomValues(new Uint8Array(24))
                    const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
                      '',
                    )
                    setCreds((prev) => ({ ...prev, [field.key]: secret }))
                  }}
                >
                  {t('components.integration.shared.generate')}
                </Button>
              )}
            </div>
          )}
          {field.helpText && <p className="text-tiny text-muted-foreground">{field.helpText}</p>}
        </div>
      ))}
      {type === 'webhook-relay' && (
        <div className="space-y-1.5">
          <Label htmlFor="relay_public_url" className="text-sm font-medium">
            {t('components.integration.connector.fields.relayPublicUrl')}
            {isEdit
              ? t('components.integration.shared.keepExisting')
              : t('components.integration.shared.optional')}
          </Label>
          <Input
            id="relay_public_url"
            className="h-9 text-sm"
            value={relayPublicUrl}
            onChange={(e) => setRelayPublicUrl(e.target.value)}
            placeholder={t('components.integration.connector.placeholders.relayPublicUrl')}
          />
          <p className="text-tiny text-muted-foreground">
            {t('components.integration.connector.help.relayPublicUrl')}
          </p>
        </div>
      )}
      <div className="flex items-start gap-3 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] p-3">
        <div className="min-w-0 flex-1">
          <Label htmlFor="is_public" className="cursor-pointer text-sm font-medium">
            {t('components.integration.connector.fields.public')}
          </Label>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {t('components.integration.connector.help.public')}
          </div>
        </div>
        <Switch id="is_public" checked={isPublic} onCheckedChange={setIsPublic} />
      </div>
      <DialogFooter>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        {onTest && (
          <Button type="button" size="sm" variant="secondary" disabled={testing} onClick={onTest}>
            {testing ? (
              <>
                <Spinner size="sm" className="mr-1.5 h-3.5 w-3.5" />{' '}
                {t('components.integration.connector.actions.testing')}
              </>
            ) : (
              <>
                <Zap className="mr-1.5 h-3.5 w-3.5" />{' '}
                {t('components.integration.connector.actions.test')}
              </>
            )}
          </Button>
        )}
        <Button type="submit" size="sm" disabled={!canSubmit || loading}>
          {loading
            ? t('components.integration.shared.saving')
            : isEdit
              ? t('common.save')
              : t('common.create')}
        </Button>
      </DialogFooter>
    </form>
  )
}

// ─── Route Form ─────────────────────────────────────────────────────

function Combobox({
  value,
  onChange,
  items,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  loading,
}: {
  value: string
  onChange: (value: string) => void
  items: Array<{ value: string; label: string }>
  placeholder: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  loading?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selected = items.find((i) => i.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between font-normal"
          disabled={disabled || loading}
        >
          <span className="truncate">
            {loading ? t('common.loading') : selected?.label || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput
            placeholder={searchPlaceholder || t('components.integration.shared.search')}
          />
          <CommandList>
            <CommandEmpty>{emptyText || t('components.integration.shared.noResults')}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.value}
                  value={item.label}
                  onSelect={() => {
                    onChange(item.value)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === item.value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function RouteForm({
  initial,
  connectors,
  workspaces,
  onSubmit,
  onCancel,
  loading,
  onConnectorTypeChange,
}: {
  initial?: Partial<CgRoute>
  connectors: CgConnector[]
  workspaces: Workspace[]
  onSubmit: (data: {
    connector_id: string
    external_id: string
    workspace_id: string
    name: string
    config?: Record<string, unknown>
  }) => void
  onCancel: () => void
  loading: boolean
  onConnectorTypeChange?: (type: string) => void
}) {
  const { t } = useTranslation()
  const [connectorId, setConnectorId] = useState(initial?.connector_id ?? '')
  const initConnectorType = connectors.find((c) => c.id === initial?.connector_id)?.type
  const [externalId, setExternalId] = useState(
    initial?.external_id ?? (initConnectorType === 'wecom' ? '*' : ''),
  )
  const [workspaceId, setWorkspaceId] = useState(initial?.workspace_id ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [prompt, setPrompt] = useState(
    ((initial?.config as Record<string, unknown>)?.prompt as string) ?? '',
  )
  const [promptId, setPromptId] = useState<string | null>(
    ((initial?.config as Record<string, unknown>)?.prompt_id as string) ?? null,
  )
  const [requireMention, setRequireMention] = useState(
    ((initial?.config as Record<string, unknown>)?.require_mention as boolean) ?? true,
  )
  const [streaming, setStreaming] = useState(
    ((initial?.config as Record<string, unknown>)?.streaming as boolean) ?? false,
  )
  const [sessionTtlHours, setSessionTtlHours] = useState(
    ((initial?.config as Record<string, unknown>)?.session_ttl_hours as number) ?? 24,
  )
  const [filters, setFilters] = useState<{ field: string; op: string; value: string }[]>(
    ((initial?.config as Record<string, unknown>)?.filters as {
      field: string
      op: string
      value: string
    }[]) ?? [],
  )
  const [routeSecret, setRouteSecret] = useState(
    ((initial?.config as Record<string, unknown>)?.secret as string) ?? '',
  )
  const [routeSecretType, setRouteSecretType] = useState(
    ((initial?.config as Record<string, unknown>)?.secret_type as string) ?? 'plain',
  )
  const [routeSecretHeader, setRouteSecretHeader] = useState(() => {
    const cfg = initial?.config as Record<string, unknown> | undefined
    if (cfg?.secret_header) return cfg.secret_header as string
    const t = (cfg?.secret_type as string) || 'plain'
    return t === 'hmac-sha256' ? 'X-Hub-Signature-256' : 'X-Webhook-Secret'
  })
  const isEdit = !!initial?.id
  const selectedConnector = connectors.find((c) => c.id === connectorId)
  const connectorType = selectedConnector?.type ?? ''

  const selectedConnectorPresetType: PresetConnectorType | null =
    connectorType === 'slack' || connectorType === 'wecom'
      ? connectorType
      : WEBHOOK_CONNECTOR_TYPES.has(connectorType)
        ? 'webhook'
        : null
  const presets = selectedConnectorPresetType ? listPromptPresets(selectedConnectorPresetType) : []

  useEffect(() => {
    if (connectorType) onConnectorTypeChange?.(connectorType)
  }, [connectorType])
  const extIdConfig = connectorType ? CONNECTOR_TYPES[connectorType]?.externalId : null
  const localizedExtIdConfig = extIdConfig
    ? {
        label: t(`components.integration.typeConfigs.${connectorType}.externalId.label`),
        placeholder: t(
          `components.integration.typeConfigs.${connectorType}.externalId.placeholder`,
        ),
        helpText: extIdConfig.helpText
          ? t(`components.integration.typeConfigs.${connectorType}.externalId.helpText`)
          : undefined,
      }
    : DEFAULT_EXTERNAL_ID

  // Fetch Slack channels when a Slack connector is selected
  const { data: channels, isLoading: channelsLoading } = useQuery({
    queryKey: ['cg-connector-channels', connectorId],
    queryFn: () => cgApi.listConnectorChannels(connectorId),
    enabled: !!connectorId && connectorType === 'slack',
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
  const slackChannelItems = [
    { value: '*', label: t('components.integration.route.labels.allChannels') },
    ...(channels || []).map((ch) => ({ value: ch.id, label: `#${ch.name}` })),
  ]
  if (
    connectorType === 'slack' &&
    externalId &&
    !slackChannelItems.some((i) => i.value === externalId)
  ) {
    slackChannelItems.push({ value: externalId, label: externalId })
  }

  const selectClass =
    'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const validFilters = filters.filter((f) => f.field.trim())
        const config: Record<string, unknown> = {
          prompt: prompt.trim() || null,
          prompt_id: promptId,
          session_ttl_hours: sessionTtlHours,
          require_mention: requireMention,
          ...(connectorType === 'wecom' ? { streaming } : {}),
          ...(validFilters.length > 0
            ? {
                filters: validFilters.map((f) => ({
                  field: f.field,
                  op: f.op,
                  value:
                    f.op === 'in'
                      ? f.value.split(',').map((v) => v.trim())
                      : f.op === 'exists'
                        ? f.value !== 'false'
                        : f.value,
                })),
              }
            : {}),
          ...(routeSecret.trim()
            ? {
                secret: routeSecret.trim(),
                secret_type: routeSecretType,
                secret_header: routeSecretHeader.trim(),
              }
            : {}),
        }
        onSubmit({
          connector_id: connectorId,
          external_id: externalId,
          workspace_id: workspaceId,
          name,
          config,
        })
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="connector_id">{t('components.integration.route.fields.connector')}</Label>
        <select
          id="connector_id"
          value={connectorId}
          onChange={(e) => {
            const newId = e.target.value
            setConnectorId(newId)
            const newType = connectors.find((c) => c.id === newId)?.type
            setExternalId(newType === 'wecom' ? '*' : '')
          }}
          required
          disabled={isEdit}
          className={selectClass}
        >
          <option value="">{t('components.integration.route.placeholders.selectConnector')}</option>
          {connectors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.type})
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label>{localizedExtIdConfig.label}</Label>
        {connectorType === 'slack' ? (
          <>
            <Combobox
              value={externalId}
              onChange={setExternalId}
              items={slackChannelItems}
              placeholder={t('components.integration.route.placeholders.selectChannel')}
              searchPlaceholder={t('components.integration.route.placeholders.searchChannels')}
              emptyText={t('components.integration.route.empty.noChannels')}
              loading={channelsLoading}
              disabled={!connectorId || isEdit}
            />
            <p className="text-xs text-muted-foreground">
              {t('components.integration.route.help.slackChannel')}
            </p>
          </>
        ) : connectorType === 'wecom' && !isEdit ? (
          <>
            <Input value="*" disabled />
            <p className="text-xs text-muted-foreground">
              {t('components.integration.route.help.wecomChannel')}
            </p>
          </>
        ) : (
          <>
            <Input
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder={localizedExtIdConfig.placeholder}
              required
              disabled={isEdit}
            />
            {localizedExtIdConfig.helpText && (
              <p className="text-xs text-muted-foreground">{localizedExtIdConfig.helpText}</p>
            )}
          </>
        )}
      </div>
      <div className="space-y-2">
        <Label>{t('components.integration.route.fields.workspace')}</Label>
        <Combobox
          value={workspaceId}
          onChange={setWorkspaceId}
          items={workspaces.map((w) => ({ value: w.id, label: w.name }))}
          placeholder={t('components.integration.route.placeholders.selectWorkspace')}
          searchPlaceholder={t('components.integration.route.placeholders.searchWorkspaces')}
          emptyText={t('components.integration.route.empty.noWorkspaces')}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="route_name">{t('components.integration.route.fields.displayName')}</Label>
        <Input
          id="route_name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('components.integration.route.placeholders.optional')}
        />
      </div>
      <div className="space-y-2">
        <PromptField
          label={t('components.integration.route.fields.promptTemplate')}
          promptId={promptId}
          content={prompt}
          onChange={(patch) => {
            if (patch.promptId !== undefined) setPromptId(patch.promptId)
            if (patch.content !== undefined) setPrompt(patch.content)
          }}
          presets={presets.map((p) => ({ id: p.id, name: p.name, content: p.body }))}
          presetsLabel={t('components.integration.route.prompt.presetsGroup')}
          placeholder={
            connectorType === 'slack'
              ? t('components.integration.route.prompt.placeholders.slack')
              : WEBHOOK_CONNECTOR_TYPES.has(connectorType)
                ? t('components.integration.route.prompt.placeholders.webhook')
                : connectorType === 'wecom'
                  ? t('components.integration.route.prompt.placeholders.wecom')
                  : t('components.integration.route.prompt.placeholders.default')
          }
          previewMaxHeight="200px"
          textareaRows={3}
        />
        <p className="text-xs text-muted-foreground">
          {WEBHOOK_CONNECTOR_TYPES.has(connectorType) ? (
            <>{t('components.integration.route.prompt.variables.webhook')}</>
          ) : connectorType === 'slack' ? (
            <>{t('components.integration.route.prompt.variables.slack')}</>
          ) : connectorType === 'wecom' ? (
            <>{t('components.integration.route.prompt.variables.wecom')}</>
          ) : (
            <>{t('components.integration.route.prompt.variables.default')}</>
          )}
        </p>
      </div>
      {WEBHOOK_CONNECTOR_TYPES.has(connectorType) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t('components.integration.route.fields.filters')}</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1 px-1.5"
              onClick={() => setFilters([...filters, { field: '', op: 'eq', value: '' }])}
            >
              <Plus className="h-3 w-3" />
              {t('components.integration.route.actions.addFilter')}
            </Button>
          </div>
          {filters.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t('components.integration.route.empty.noFilters')}
            </p>
          )}
          {filters.map((f, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={f.field}
                onChange={(e) => {
                  const next = [...filters]
                  next[i] = { ...f, field: e.target.value }
                  setFilters(next)
                }}
                placeholder={t('components.integration.route.filters.fieldPlaceholder')}
                className="flex-1 h-8 text-xs font-mono"
              />
              <select
                value={f.op}
                onChange={(e) => {
                  const next = [...filters]
                  next[i] = { ...f, op: e.target.value }
                  setFilters(next)
                }}
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              >
                <option value="eq">=</option>
                <option value="neq">≠</option>
                <option value="in">{t('components.integration.route.filters.ops.in')}</option>
                <option value="contains">
                  {t('components.integration.route.filters.ops.contains')}
                </option>
                <option value="exists">
                  {t('components.integration.route.filters.ops.exists')}
                </option>
              </select>
              {f.op !== 'exists' ? (
                <Input
                  value={f.value}
                  onChange={(e) => {
                    const next = [...filters]
                    next[i] = { ...f, value: e.target.value }
                    setFilters(next)
                  }}
                  placeholder={
                    f.op === 'in'
                      ? t('components.integration.route.filters.valuePlaceholders.in')
                      : t('components.integration.route.filters.valuePlaceholders.default')
                  }
                  className="flex-1 h-8 text-xs"
                />
              ) : (
                <select
                  value={f.value || 'true'}
                  onChange={(e) => {
                    const next = [...filters]
                    next[i] = { ...f, value: e.target.value }
                    setFilters(next)
                  }}
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-xs flex-1"
                >
                  <option value="true">
                    {t('components.integration.route.filters.boolean.true')}
                  </option>
                  <option value="false">
                    {t('components.integration.route.filters.boolean.false')}
                  </option>
                </select>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                onClick={() => setFilters(filters.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          {filters.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('components.integration.route.help.filters')}
            </p>
          )}
        </div>
      )}
      {WEBHOOK_CONNECTOR_TYPES.has(connectorType ?? '') && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <Label className="text-xs text-muted-foreground">
            {t('components.integration.route.fields.secret')}
            {t('components.integration.shared.optional')}
          </Label>
          <select
            value={routeSecretType}
            onChange={(e) => {
              const t = e.target.value
              setRouteSecretType(t)
              setRouteSecretHeader(t === 'hmac-sha256' ? 'X-Hub-Signature-256' : 'X-Webhook-Secret')
            }}
            className={selectClass}
          >
            <option value="plain">{t('components.integration.route.secretTypes.plain')}</option>
            <option value="hmac-sha256">HMAC-SHA256</option>
          </select>
          <div className="flex gap-1.5">
            <Input
              value={routeSecret}
              onChange={(e) => setRouteSecret(e.target.value)}
              placeholder={t('components.integration.route.placeholders.webhookSecret')}
              type={routeSecret ? 'text' : 'password'}
              className="flex-1 min-w-0"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 h-9 text-xs"
              onClick={() => {
                const bytes = crypto.getRandomValues(new Uint8Array(24))
                setRouteSecret(Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''))
              }}
            >
              {t('components.integration.shared.generate')}
            </Button>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="shrink-0">{t('components.integration.route.fields.header')}</span>
            <Input
              value={routeSecretHeader}
              onChange={(e) => setRouteSecretHeader(e.target.value)}
              className="h-6 text-xs px-2 flex-1 min-w-0"
            />
          </div>
        </div>
      )}
      {connectorType === 'slack' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="require_mention"
              checked={requireMention}
              onChange={(e) => setRequireMention(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="require_mention" className="text-sm font-normal">
              {t('components.integration.route.fields.requireMention')}
            </Label>
          </div>
          {!requireMention && (
            <p className="text-xs text-muted-foreground">
              {t('components.integration.route.help.requireMention')}
            </p>
          )}
        </div>
      )}
      {connectorType === 'wecom' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="streaming"
              checked={streaming}
              onChange={(e) => setStreaming(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="streaming" className="text-sm font-normal">
              {t('components.integration.route.fields.streaming')}
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('components.integration.route.help.streaming')}
          </p>
        </div>
      )}
      {!WEBHOOK_CONNECTOR_TYPES.has(connectorType ?? '') && (
        <div className="space-y-2">
          <Label htmlFor="session_ttl">{t('components.integration.route.fields.sessionTtl')}</Label>
          <Input
            id="session_ttl"
            type="number"
            min={1}
            max={720}
            value={sessionTtlHours}
            onChange={(e) => setSessionTtlHours(Number(e.target.value) || 24)}
          />
          <p className="text-xs text-muted-foreground">
            {t('components.integration.route.help.sessionTtl')}
          </p>
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          disabled={!connectorId.trim() || !externalId.trim() || !workspaceId.trim() || loading}
        >
          {loading
            ? t('components.integration.shared.saving')
            : isEdit
              ? t('common.save')
              : t('common.create')}
        </Button>
      </DialogFooter>
    </form>
  )
}
