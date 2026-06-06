import { CONNECTOR_TYPES, ConnectorForm, RouteForm } from '@/components/IntegrationPage'
import { RouteCardView } from '@/components/integration/RouteCardView'
import { ResourceFilterTabs, type ScopeFilter } from '@/components/resource/ResourceFilterTabs'
import type { ResourceScope } from '@/components/resource/ScopeBadge'
import { ScopeBadge } from '@/components/resource/ScopeBadge'
import { MasterSidebar, SidebarIconTile } from '@/components/shell/master-sidebar/MasterSidebar'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import { EmptyHero } from '@/components/ui/empty-hero'
import { EmptyIllustration } from '@/components/ui/empty-illustration'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/contexts/AuthContext'
import { useDialogStack } from '@/contexts/DialogStackContext'
import { getConnectorDoc, getConnectorDocsHint } from '@/docs/inline-help/connector-docs'
import { getRouteDoc, getRouteDocsHint } from '@/docs/inline-help/route-docs'
import type { CgConnector, CgRoute } from '@/lib/api/channel-gateway'
import { cgApi } from '@/lib/api/channel-gateway'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight,
  type LucideIcon,
  MessageCircle,
  Pencil,
  Plug,
  Plus,
  Slack,
  Trash2,
  Webhook,
  Zap,
} from 'lucide-react'
import { Fragment, type ReactNode, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

// Re-use RouteForm from IntegrationPage (it's not exported, so we import the dialog wrapper approach)
// We'll import what we need and inline the route form dialog

// ─── Helpers ────────────────────────────────────────────────────────

const CONNECTOR_VISUAL: Record<string, { tone: string; Icon: LucideIcon }> = {
  slack: { tone: 'bg-purple-500', Icon: Slack },
  wecom: { tone: 'bg-emerald-500', Icon: MessageCircle },
  webhook: { tone: 'bg-blue-500', Icon: Webhook },
  'webhook-relay': { tone: 'bg-indigo-500', Icon: Webhook },
}

const CONNECTOR_FALLBACK_VISUAL = { tone: 'bg-muted-foreground/40', Icon: Plug }

function connectorVisual(type: string) {
  return CONNECTOR_VISUAL[type] ?? CONNECTOR_FALLBACK_VISUAL
}

type StatusTone = 'success' | 'destructive' | 'info' | 'warning' | 'muted'

function jobStateTone(state: string): StatusTone {
  switch (state) {
    case 'completed':
      return 'success'
    case 'failed':
    case 'cancelled':
      return 'destructive'
    case 'active':
      return 'info'
    case 'retry':
      return 'warning'
    default:
      return 'muted'
  }
}

function eventStatusTone(status: string): StatusTone {
  if (status === 'success') return 'success'
  if (status === 'error') return 'destructive'
  return 'muted'
}

/**
 * Soft-tinted status pill used inside the events table — quieter than a
 * regular Badge so a dense list of events doesn't read as a parade of
 * loud chips. A small leading dot keeps the state glanceable.
 */
function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const toneClass: Record<StatusTone, string> = {
    success: 'bg-success/10 text-success',
    destructive: 'bg-destructive/10 text-destructive',
    info: 'bg-info/10 text-info',
    warning: 'bg-warning/10 text-warning',
    muted: 'bg-foreground/[0.06] text-muted-foreground',
  }
  const dotClass: Record<StatusTone, string> = {
    success: 'bg-success',
    destructive: 'bg-destructive',
    info: 'bg-info',
    warning: 'bg-warning',
    muted: 'bg-muted-foreground/60',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-tiny font-medium',
        toneClass[tone],
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dotClass[tone])} />
      {children}
    </span>
  )
}

function formatDuration(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (Number.isNaN(ms) || ms < 0) return null
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rs = Math.round(s % 60)
  return `${m}m ${rs}s`
}

function timeAgo(date: string, t: (key: string, options?: Record<string, unknown>) => string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return t('components.connectorsSection.timeAgo.seconds', { count: seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('components.connectorsSection.timeAgo.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('components.connectorsSection.timeAgo.hours', { count: hours })
  const days = Math.floor(hours / 24)
  return t('components.connectorsSection.timeAgo.days', { count: days })
}

// ─── Component ──────────────────────────────────────────────────────

export function ConnectorsSection({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useInstancePersistentState<string | null>(
    instanceId,
    'connectorsSelectedId',
    () => null,
  )
  const [activeTab, setActiveTab] = useInstancePersistentState<'routes' | 'events'>(
    instanceId,
    'connectorsTab',
    () => 'routes',
  )
  const [scopeFilter, setScopeFilter] = useInstancePersistentState<ScopeFilter>(
    instanceId,
    'connectorsScopeFilter',
    () => 'all',
  )
  const [search, setSearch] = useState('')

  const queryClient = useQueryClient()
  const { open: openDialog } = useDialogStack()
  const headerSlot = useAppHeaderSlot()

  // ── Data ──
  const { data: connectors } = useQuery({
    queryKey: ['cg-connectors'],
    queryFn: () => cgApi.listConnectors(),
  })

  const { data: routes } = useQuery({
    queryKey: ['cg-routes', selectedId],
    queryFn: () => cgApi.listRoutes(selectedId ?? undefined),
    enabled: !!selectedId,
  })

  const { data: eventsData } = useQuery({
    queryKey: ['cg-events', selectedId],
    queryFn: () => cgApi.listEvents({ connector_id: selectedId ?? undefined, limit: 30 }),
    enabled: !!selectedId && activeTab === 'events',
    refetchInterval: 10000,
  })

  const { data: workspaces } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api.getWorkspaces(),
  })

  const { user } = useAuth()
  const selectedConnector = connectors?.find((c) => c.id === selectedId) ?? null

  const connectorScope = (c: CgConnector): ResourceScope => (c.is_public ? 'public' : 'private')

  const scopeCounts = useMemo(() => {
    const c: Partial<Record<ScopeFilter, number>> = {
      all: connectors?.length ?? 0,
      private: 0,
      team: 0,
      public: 0,
    }
    for (const conn of connectors ?? []) {
      if (conn.is_public) c.public = (c.public ?? 0) + 1
      else c.private = (c.private ?? 0) + 1
    }
    return c
  }, [connectors])

  const visibleConnectors = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (connectors ?? []).filter((c) => {
      if (scopeFilter !== 'all') {
        if (scopeFilter === 'team') return false
        if (connectorScope(c) !== scopeFilter) return false
      }
      if (q && !c.name.toLowerCase().includes(q) && !c.type.toLowerCase().includes(q)) return false
      return true
    })
  }, [connectors, scopeFilter, search])
  const {
    data: selectedSlackChannels,
    isLoading: selectedSlackChannelsLoading,
    isError: selectedSlackChannelsError,
  } = useQuery({
    queryKey: ['cg-connector-channels', selectedId],
    queryFn: () => cgApi.listConnectorChannels(selectedId as string),
    enabled: !!selectedId && selectedConnector?.type === 'slack',
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
  const isOwner = selectedConnector ? selectedConnector.user_id === user?.id : false
  const selectedSlackChannelNameById = new Map(
    selectedSlackChannels?.map((channel) => [channel.id, channel.name]) ?? [],
  )
  const getRouteExternalResolution = (
    route: CgRoute,
  ):
    | { label?: string; status?: 'loading' | 'missing' | 'error'; statusText?: string }
    | undefined => {
    const connectorType = route.connector_type || selectedConnector?.type
    // Catch-all routes ('*') always resolve to the same friendly label
    // regardless of connector type — it's the closest thing routes have
    // to a "match anything" semantic.
    if (route.external_id === '*') {
      return { label: t('components.integration.route.labels.allChannels') }
    }
    if (connectorType !== 'slack') return undefined
    if (selectedSlackChannelsLoading) {
      return {
        status: 'loading' as const,
        statusText: t('components.integration.routeCardView.channel.resolving'),
      }
    }
    if (selectedSlackChannelsError) {
      return {
        status: 'error' as const,
        statusText: t('components.integration.routeCardView.channel.loadFailed'),
      }
    }
    const channelName = selectedSlackChannelNameById.get(route.external_id)
    if (!channelName) {
      return {
        status: 'missing' as const,
        statusText: t('components.integration.routeCardView.channel.notFound'),
      }
    }
    return { label: `#${channelName}` }
  }

  // ── Connector mutations ──
  const [editTarget, setEditTarget] = useState<CgConnector | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CgConnector | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)

  const runTest = (id: string) => {
    setTestingId(id)
    cgApi
      .testConnector(id)
      .then((res) => {
        const d = res.detail
        toast.success(
          t('components.createConnector.toasts.connected', {
            team: d.team || '?',
            user: d.user || '?',
          }),
        )
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setTestingId(null))
  }

  const updateConnectorMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Parameters<typeof cgApi.updateConnector>[1]) =>
      cgApi.updateConnector(id, data),
    onSuccess: (updated, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cg-connectors'] })
      setEditTarget(null)
      toast.success(t('components.connectorsSection.toasts.connectorUpdated'))
      if (CONNECTOR_TYPES[updated.type]?.testable) runTest(variables.id)
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteConnectorMutation = useMutation({
    mutationFn: cgApi.deleteConnector,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cg-connectors'] })
      setDeleteTarget(null)
      toast.success(t('components.connectorsSection.toasts.connectorDeleted'))
      if (selectedId === deleteTarget?.id) setSelectedId(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const toggleConnectorEnabled = (c: CgConnector) => {
    updateConnectorMutation.mutate({ id: c.id, enabled: !c.enabled })
  }

  // ── Route mutations ──
  const [editRoute, setEditRoute] = useState<CgRoute | null>(null)
  const [deleteRoute, setDeleteRoute] = useState<CgRoute | null>(null)
  const [createRouteOpen, setCreateRouteOpen] = useState(false)
  const [routeConnectorType, setRouteConnectorType] = useState('')

  const createRouteMutation = useMutation({
    mutationFn: cgApi.createRoute,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cg-routes'] })
      setCreateRouteOpen(false)
      toast.success(t('components.createRoute.toasts.created'))
    },
    onError: (err) => toast.error(err.message),
  })

  const updateRouteMutation = useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string
      name?: string
      workspace_id?: string
      config?: Record<string, unknown>
      enabled?: boolean
    }) => cgApi.updateRoute(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cg-routes'] })
      setEditRoute(null)
      toast.success(t('components.connectorsSection.toasts.routeUpdated'))
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteRouteMutation = useMutation({
    mutationFn: cgApi.deleteRoute,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cg-routes'] })
      setDeleteRoute(null)
      toast.success(t('components.connectorsSection.toasts.routeDeleted'))
    },
    onError: (err) => toast.error(err.message),
  })

  // ── Events ──
  const events = eventsData?.events
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null)

  // ── Render ──
  return (
    <div className="flex h-full overflow-hidden">
      {headerSlot &&
        createPortal(
          <>
            <AppHeaderButton
              icon={Plus}
              label={t('components.connectorsSection.actions.new')}
              onClick={() => openDialog('create-connector')}
            />
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-foreground/[0.10]" />
            <ResourceFilterTabs
              value={scopeFilter}
              onValueChange={setScopeFilter}
              counts={scopeCounts}
            />
          </>,
          headerSlot,
        )}
      {/* ── Left: Connector List ── */}
      <MasterSidebar width="md">
        <MasterSidebar.Search value={search} onChange={setSearch} />
        <MasterSidebar.List>
          {(connectors?.length ?? 0) === 0 ? (
            <MasterSidebar.Empty>
              {t('components.connectorsSection.empty.noConnectors.description')}
            </MasterSidebar.Empty>
          ) : visibleConnectors.length === 0 ? (
            <MasterSidebar.Empty>{t('components.resource.filter.empty')}</MasterSidebar.Empty>
          ) : (
            visibleConnectors.map((c) => {
              const visual = connectorVisual(c.type)
              return (
                <MasterSidebar.Item
                  key={c.id}
                  selected={selectedId === c.id}
                  onSelect={() => setSelectedId(c.id)}
                  leading={
                    <SidebarIconTile icon={visual.Icon} tone={visual.tone} muted={!c.enabled} />
                  }
                  trailing={<ScopeBadge scope={connectorScope(c)} compact />}
                >
                  {c.name}
                </MasterSidebar.Item>
              )
            })
          )}
        </MasterSidebar.List>
      </MasterSidebar>

      {/* ── Right: Detail ── */}
      {selectedConnector ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Detail header — name + caption + owner action group.
              Type/scope/enabled are conveyed by the sidebar tile, scope
              filter and the Switch itself; we don't repeat them here. */}
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold">{selectedConnector.name}</h2>
              <p className="text-xs text-muted-foreground">
                {t(`components.integration.typeConfigs.${selectedConnector.type}.label`, {
                  defaultValue: selectedConnector.type,
                })}
              </p>
            </div>
            {isOwner && (
              <div className="flex items-center gap-2 shrink-0 ml-auto">
                <Switch
                  checked={selectedConnector.enabled}
                  onCheckedChange={() => toggleConnectorEnabled(selectedConnector)}
                  aria-label={t('components.connectorsSection.actions.toggleEnabled')}
                />
                <span aria-hidden className="mx-0.5 h-4 w-px bg-foreground/[0.10]" />
                {CONNECTOR_TYPES[selectedConnector.type]?.testable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    disabled={testingId === selectedConnector.id}
                    onClick={() => runTest(selectedConnector.id)}
                    title={t('components.connectorsSection.actions.testConnectivity')}
                  >
                    {testingId === selectedConnector.id ? (
                      <Spinner size="sm" className="h-3.5 w-3.5" />
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => setEditTarget(selectedConnector)}
                  title={t('components.connectorsSection.actions.edit')}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteTarget(selectedConnector)}
                  title={t('components.connectorsSection.actions.delete')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* Tabs row — pill SegmentedControl unifies with scope filter
              and other tabbed surfaces; trailing slot carries the
              tab-scoped action (e.g. "+ New route"). */}
          <div className="shrink-0 px-5 pb-2">
            <SegmentedControl
              mode="tabs"
              size="sm"
              value={activeTab}
              onValueChange={setActiveTab}
              ariaLabel={t('components.connectorsSection.tabs.events')}
              options={[
                {
                  value: 'routes',
                  label: t('components.connectorsSection.tabs.routes', {
                    count: routes?.length ?? 0,
                  }),
                },
                { value: 'events', label: t('components.connectorsSection.tabs.events') },
              ]}
            />
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
            {activeTab === 'routes' && (
              <div className="space-y-3">
                {routes && routes.length === 0 ? (
                  <EmptyHero
                    className="py-6"
                    illustration={<EmptyIllustration src="connectors" size="h-20" />}
                    title={t('components.connectorsSection.empty.noRoutes.title')}
                    description={t('components.connectorsSection.empty.noRoutes.description')}
                    action={
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setCreateRouteOpen(true)}
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        {t('components.connectorsSection.actions.newRoute')}
                      </Button>
                    }
                  />
                ) : (
                  <div className="grid gap-3 @2xl/panel:grid-cols-2">
                    {routes?.map((route) => {
                      const wsName = workspaces?.find((w) => w.id === route.workspace_id)?.name
                      const externalResolution = getRouteExternalResolution(route)
                      const routeType = route.connector_type || ''
                      const externalIdLabel = t(
                        `components.integration.typeConfigs.${routeType}.externalId.label`,
                        { defaultValue: t('components.integration.routeCardView.fields.id') },
                      )
                      return (
                        <RouteCardView
                          key={route.id}
                          id={route.id}
                          name={route.name || externalResolution?.label || route.external_id}
                          workspaceName={wsName}
                          workspaceId={route.workspace_id}
                          externalId={route.external_id}
                          externalLabel={externalResolution?.label}
                          externalLabelStatus={externalResolution?.status}
                          externalLabelStatusText={externalResolution?.statusText}
                          externalIdLabel={externalIdLabel}
                          connectorType={routeType}
                          connectorId={route.connector_id}
                          webhookBaseUrl={import.meta.env.VITE_CHANNEL_GATEWAY_PUBLIC_URL || ''}
                          relayPublicUrl={
                            (selectedConnector?.config?.relay_public_url as string) || undefined
                          }
                          enabled={route.enabled}
                          actions={
                            <>
                              <Switch
                                checked={route.enabled}
                                onCheckedChange={() =>
                                  updateRouteMutation.mutate({
                                    id: route.id,
                                    enabled: !route.enabled,
                                  })
                                }
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                onClick={() => setEditRoute(route)}
                                title={t('components.connectorsSection.actions.edit')}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                onClick={() => setDeleteRoute(route)}
                                title={t('components.connectorsSection.actions.delete')}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </>
                          }
                        />
                      )
                    })}
                    <button
                      type="button"
                      onClick={() => setCreateRouteOpen(true)}
                      className={cn(
                        'group/add flex min-h-[8.5rem] flex-col items-center justify-center gap-2',
                        'rounded-xl border-2 border-dashed border-foreground/[0.10]',
                        'text-muted-foreground/70 transition-colors',
                        'hover:border-foreground/[0.20] hover:bg-foreground/[0.03] hover:text-foreground',
                        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
                      )}
                    >
                      <Plus className="h-5 w-5" strokeWidth={1.75} />
                      <span className="text-xs">
                        {t('components.connectorsSection.actions.newRoute')}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'events' && (
              <div className="space-y-3">
                {events && events.length === 0 && (
                  <EmptyHero
                    className="py-6"
                    illustration={<EmptyIllustration src="connectors" size="h-20" />}
                    title={t('components.connectorsSection.empty.noEvents.title')}
                    description={t('components.connectorsSection.empty.noEvents.description')}
                  />
                )}
                {events && events.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="px-4 py-2.5 font-medium">
                            {t('components.connectorsSection.table.time')}
                          </th>
                          <th className="px-4 py-2.5 font-medium">
                            {t('components.connectorsSection.table.event')}
                          </th>
                          <th className="px-4 py-2.5 font-medium">
                            {t('components.connectorsSection.table.job')}
                          </th>
                          <th className="px-4 py-2.5 font-medium">
                            {t('components.connectorsSection.table.status')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.map((event) => (
                          <Fragment key={event.id}>
                            {/* biome-ignore lint/a11y/useKeyWithClickEvents: row click toggles expansion; keyboard users have other affordances */}
                            <tr
                              className="border-b border-border last:border-0 hover:bg-accent/30 cursor-pointer"
                              onClick={() =>
                                setExpandedEventId(expandedEventId === event.id ? null : event.id)
                              }
                            >
                              <td
                                className="px-4 py-2.5 text-muted-foreground"
                                title={new Date(event.created_at).toLocaleString()}
                              >
                                <span className="flex items-center gap-1.5">
                                  <ChevronRight
                                    className={cn(
                                      'h-3 w-3 transition-transform',
                                      expandedEventId === event.id && 'rotate-90',
                                    )}
                                  />
                                  {timeAgo(event.created_at, t)}
                                </span>
                              </td>
                              <td className="px-4 py-2.5">{event.event_type}</td>
                              <td className="px-4 py-2.5 font-mono text-xs">
                                {event.job_id ? (
                                  event.job_id.slice(0, 8)
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                {event.job_state ? (
                                  <StatusPill tone={jobStateTone(event.job_state)}>
                                    {event.job_state}
                                  </StatusPill>
                                ) : (
                                  <StatusPill tone={eventStatusTone(event.status)}>
                                    {event.status}
                                  </StatusPill>
                                )}
                                {event.job_state &&
                                  event.job_started_on &&
                                  event.job_completed_on && (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      {formatDuration(event.job_started_on, event.job_completed_on)}
                                    </span>
                                  )}
                                {event.job_state === 'active' && event.job_started_on && (
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    {timeAgo(event.job_started_on, t)}
                                  </span>
                                )}
                                {event.error && (
                                  <span className="ml-2 text-xs text-destructive">
                                    {event.error.length > 40
                                      ? `${event.error.slice(0, 40)}...`
                                      : event.error}
                                  </span>
                                )}
                              </td>
                            </tr>
                            {expandedEventId === event.id && (
                              <tr className="border-b border-border last:border-0">
                                <td colSpan={4} className="px-4 py-3 bg-muted/30">
                                  <div className="space-y-2 text-xs">
                                    <div className="flex gap-4">
                                      <span className="text-muted-foreground shrink-0">
                                        {t('components.connectorsSection.table.time')}
                                      </span>
                                      <span>{new Date(event.created_at).toLocaleString()}</span>
                                    </div>
                                    {event.job_id && (
                                      <div className="flex gap-4">
                                        <span className="text-muted-foreground shrink-0">
                                          {t('components.connectorsSection.table.jobId')}
                                        </span>
                                        <span className="font-mono">{event.job_id}</span>
                                      </div>
                                    )}
                                    {event.job_state && (
                                      <div className="flex gap-4">
                                        <span className="text-muted-foreground shrink-0">
                                          {t('components.connectorsSection.table.jobState')}
                                        </span>
                                        <span>
                                          <StatusPill tone={jobStateTone(event.job_state)}>
                                            {event.job_state}
                                          </StatusPill>
                                          {typeof event.job_retry_count === 'number' &&
                                            event.job_retry_count > 0 && (
                                              <span className="ml-2 text-muted-foreground">
                                                {t(
                                                  'components.connectorsSection.table.retryCount',
                                                  { count: event.job_retry_count },
                                                )}
                                              </span>
                                            )}
                                        </span>
                                      </div>
                                    )}
                                    {event.job_started_on && (
                                      <div className="flex gap-4">
                                        <span className="text-muted-foreground shrink-0">
                                          {t('components.connectorsSection.table.jobStartedOn')}
                                        </span>
                                        <span>
                                          {new Date(event.job_started_on).toLocaleString()}
                                        </span>
                                      </div>
                                    )}
                                    {event.job_completed_on && (
                                      <div className="flex gap-4">
                                        <span className="text-muted-foreground shrink-0">
                                          {t('components.connectorsSection.table.jobCompletedOn')}
                                        </span>
                                        <span>
                                          {new Date(event.job_completed_on).toLocaleString()}
                                          {event.job_started_on && (
                                            <span className="ml-2 text-muted-foreground">
                                              (
                                              {formatDuration(
                                                event.job_started_on,
                                                event.job_completed_on,
                                              )}
                                              )
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                    )}
                                    {event.status && event.status !== 'success' && (
                                      <div className="flex gap-4">
                                        <span className="text-muted-foreground shrink-0">
                                          {t('components.connectorsSection.table.eventStatus')}
                                        </span>
                                        <StatusPill tone={eventStatusTone(event.status)}>
                                          {event.status}
                                        </StatusPill>
                                      </div>
                                    )}
                                    {event.error && (
                                      <div className="flex gap-4">
                                        <span className="text-muted-foreground shrink-0">
                                          {t('components.connectorsSection.table.error')}
                                        </span>
                                        <span className="text-destructive break-all">
                                          {event.error}
                                        </span>
                                      </div>
                                    )}
                                    {event.payload != null && (
                                      <div className="flex gap-4">
                                        <span className="text-muted-foreground shrink-0">
                                          {t('components.connectorsSection.table.payload')}
                                        </span>
                                        <pre className="font-mono whitespace-pre-wrap break-all text-muted-foreground">
                                          {JSON.stringify(event.payload, null, 2)}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-muted-foreground/40">
              {t('components.connectorsSection.empty.selectConnector')}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 text-xs text-muted-foreground"
              onClick={() => openDialog('create-connector')}
            >
              <Plus className="h-3 w-3 mr-1" />{' '}
              {t('components.connectorsSection.actions.createConnector')}
            </Button>
          </div>
        </div>
      )}

      {/* ── Connector Edit Dialog ── */}
      <DocumentedDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        title={t('components.connectorsSection.dialogs.editConnectorTitle')}
        docs={editTarget ? getConnectorDoc(editTarget.type) : undefined}
        docsHint={getConnectorDocsHint()}
        size="lg"
      >
        {editTarget && (
          <ConnectorForm
            initial={editTarget}
            onSubmit={(data) => updateConnectorMutation.mutate({ id: editTarget.id, ...data })}
            onCancel={() => setEditTarget(null)}
            loading={updateConnectorMutation.isPending}
            onTest={
              CONNECTOR_TYPES[editTarget.type]?.testable ? () => runTest(editTarget.id) : undefined
            }
            testing={testingId === editTarget.id}
          />
        )}
      </DocumentedDialog>

      {/* ── Connector Delete Dialog ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('components.connectorsSection.dialogs.deleteConnectorTitle')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('components.connectorsSection.dialogs.deleteConnectorDescription', {
              name: deleteTarget?.name ?? '',
            })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteConnectorMutation.mutate(deleteTarget.id)}
              disabled={deleteConnectorMutation.isPending}
            >
              {deleteConnectorMutation.isPending
                ? t('components.connectorsSection.actions.deleting')
                : t('components.connectorsSection.actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Route Create Dialog ── */}
      <DocumentedDialog
        open={createRouteOpen}
        onOpenChange={setCreateRouteOpen}
        title={t('components.createRoute.title')}
        docs={getRouteDoc(routeConnectorType)}
        docsHint={getRouteDocsHint()}
      >
        <RouteForm
          initial={selectedConnector ? { connector_id: selectedConnector.id } : undefined}
          connectors={connectors || []}
          workspaces={workspaces || []}
          onSubmit={(data) => createRouteMutation.mutate(data)}
          onCancel={() => setCreateRouteOpen(false)}
          loading={createRouteMutation.isPending}
          onConnectorTypeChange={setRouteConnectorType}
        />
      </DocumentedDialog>

      {/* ── Route Edit Dialog ── */}
      <DocumentedDialog
        open={!!editRoute}
        onOpenChange={(open) => !open && setEditRoute(null)}
        title={t('components.connectorsSection.dialogs.editRouteTitle')}
        docs={getRouteDoc(routeConnectorType)}
        docsHint={getRouteDocsHint()}
      >
        {editRoute && (
          <RouteForm
            initial={editRoute}
            connectors={connectors || []}
            workspaces={workspaces || []}
            onSubmit={(data) =>
              updateRouteMutation.mutate({
                id: editRoute.id,
                name: data.name,
                workspace_id: data.workspace_id,
                config: data.config,
              })
            }
            onCancel={() => setEditRoute(null)}
            loading={updateRouteMutation.isPending}
            onConnectorTypeChange={setRouteConnectorType}
          />
        )}
      </DocumentedDialog>

      {/* ── Route Delete Dialog ── */}
      <Dialog open={!!deleteRoute} onOpenChange={(open) => !open && setDeleteRoute(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('components.connectorsSection.dialogs.deleteRouteTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('components.connectorsSection.dialogs.deleteRouteDescription', {
              name: deleteRoute?.name || deleteRoute?.external_id || '',
            })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteRoute(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteRoute && deleteRouteMutation.mutate(deleteRoute.id)}
              disabled={deleteRouteMutation.isPending}
            >
              {deleteRouteMutation.isPending
                ? t('components.connectorsSection.actions.deleting')
                : t('components.connectorsSection.actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
