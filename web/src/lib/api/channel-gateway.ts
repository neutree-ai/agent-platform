import { i18n } from '@/lib/i18n'

export interface CgConnector {
  id: string
  user_id: string
  type: string
  name: string
  config: Record<string, unknown>
  is_public: boolean
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface CgRoute {
  id: string
  connector_id: string
  external_id: string
  workspace_id: string
  name: string | null
  config: Record<string, unknown>
  enabled: boolean
  created_at: string
  updated_at: string
  connector_type?: string
  connector_name?: string
}

interface CgEvent {
  id: string
  route_id: string | null
  connector_id: string | null
  event_type: string
  payload: unknown
  job_id: string | null
  status: string
  error: string | null
  created_at: string
  connector_type?: string
  job_state?: string | null
  job_started_on?: string | null
  job_completed_on?: string | null
  job_retry_count?: number | null
}

// Channel Gateway API (proxied via /_cg/)
export const cgApi = {
  // Connectors
  listConnectors: () =>
    fetch('/_cg/connectors', { credentials: 'include' }).then((r) => {
      if (!r.ok) throw new Error(i18n.t('integration.errors.requestFailed'))
      return r.json() as Promise<CgConnector[]>
    }),

  createConnector: (data: {
    type: string
    name: string
    credentials?: Record<string, unknown>
    config?: Record<string, unknown>
    is_public?: boolean
  }) =>
    fetch('/_cg/connectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    }).then((r) => {
      if (!r.ok) throw new Error(i18n.t('integration.errors.requestFailed'))
      return r.json() as Promise<CgConnector>
    }),

  updateConnector: (
    id: string,
    data: Partial<Pick<CgConnector, 'name' | 'config' | 'enabled' | 'is_public'>> & {
      credentials?: Record<string, unknown>
    },
  ) =>
    fetch(`/_cg/connectors/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    }).then((r) => {
      if (!r.ok) throw new Error(i18n.t('integration.errors.requestFailed'))
      return r.json() as Promise<CgConnector>
    }),

  deleteConnector: (id: string) =>
    fetch(`/_cg/connectors/${id}`, { method: 'DELETE', credentials: 'include' }).then((r) => {
      if (!r.ok) throw new Error(i18n.t('integration.errors.requestFailed'))
    }),

  getConnectorCredentials: (id: string) =>
    fetch(`/_cg/connectors/${id}/credentials`, { credentials: 'include' }).then((r) => {
      if (!r.ok) throw new Error(i18n.t('integration.errors.requestFailed'))
      return r.json() as Promise<Record<string, unknown>>
    }),

  testConnector: (id: string) =>
    fetch(`/_cg/connectors/${id}/test`, { method: 'POST', credentials: 'include' }).then(
      async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || i18n.t('integration.errors.testFailed'))
        return data as { ok: boolean; detail: { team?: string; user?: string; bot_id?: string } }
      },
    ),

  listConnectorChannels: (id: string) =>
    fetch(`/_cg/connectors/${id}/channels`, { credentials: 'include' }).then(async (r) => {
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || i18n.t('integration.errors.requestFailed'))
      return data as Array<{ id: string; name: string }>
    }),

  // Routes
  listRoutes: (connectorId?: string) => {
    const qs = connectorId ? `?connector_id=${connectorId}` : ''
    return fetch(`/_cg/routes${qs}`, { credentials: 'include' }).then((r) => {
      if (!r.ok) throw new Error(i18n.t('integration.errors.requestFailed'))
      return r.json() as Promise<CgRoute[]>
    })
  },

  createRoute: (data: {
    connector_id: string
    external_id: string
    workspace_id: string
    name?: string
    config?: Record<string, unknown>
  }) =>
    fetch('/_cg/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    }).then((r) => {
      if (!r.ok) throw new Error(i18n.t('integration.errors.requestFailed'))
      return r.json() as Promise<CgRoute>
    }),

  updateRoute: (
    id: string,
    data: Partial<Pick<CgRoute, 'name' | 'workspace_id' | 'config' | 'enabled'>>,
  ) =>
    fetch(`/_cg/routes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    }).then((r) => {
      if (!r.ok) throw new Error(i18n.t('integration.errors.requestFailed'))
      return r.json() as Promise<CgRoute>
    }),

  deleteRoute: (id: string) =>
    fetch(`/_cg/routes/${id}`, { method: 'DELETE', credentials: 'include' }).then((r) => {
      if (!r.ok) throw new Error(i18n.t('integration.errors.requestFailed'))
    }),

  getRouteSecret: (id: string) =>
    fetch(`/_cg/routes/${id}/secret`, { credentials: 'include' }).then((r) => {
      if (!r.ok) throw new Error(i18n.t('integration.errors.requestFailed'))
      return r.json() as Promise<{ secret: string }>
    }),

  // Sessions
  getSessionSource: (sessionId: string) =>
    fetch(`/_cg/sessions/${sessionId}/source`, { credentials: 'include' })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{
              type: string
              connector_name: string
              channel_id: string
              thread_id: string
              route_name: string | null
              url: string | null
            }>)
          : null,
      )
      .catch(() => null),

  // Events
  listEvents: (params?: {
    route_id?: string
    connector_id?: string
    limit?: number
    offset?: number
  }) => {
    const search = new URLSearchParams()
    if (params?.route_id) search.set('route_id', params.route_id)
    if (params?.connector_id) search.set('connector_id', params.connector_id)
    if (params?.limit) search.set('limit', String(params.limit))
    if (params?.offset) search.set('offset', String(params.offset))
    const qs = search.toString()
    return fetch(`/_cg/events${qs ? `?${qs}` : ''}`, { credentials: 'include' }).then((r) => {
      if (!r.ok) throw new Error(i18n.t('integration.errors.requestFailed'))
      return r.json() as Promise<{ events: CgEvent[]; total: number }>
    })
  },
}
