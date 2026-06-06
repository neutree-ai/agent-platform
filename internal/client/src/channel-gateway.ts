import type { HttpClient } from './http'

export interface CgConnector {
  id: string
  type: string
  name: string
  config: Record<string, unknown>
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

export interface CgEventLog {
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
}

const PREFIX = '/_cg'

export class ChannelGatewayApi {
  constructor(private http: HttpClient) {}

  // --- Connectors ---

  async listConnectors(): Promise<CgConnector[]> {
    return this.http.fetchJson(`${PREFIX}/connectors`)
  }

  async createConnector(data: {
    type: string
    name: string
    credentials?: Record<string, unknown>
    config?: Record<string, unknown>
  }): Promise<CgConnector> {
    return this.http.fetchJson(`${PREFIX}/connectors`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateConnector(
    id: string,
    data: { name?: string; credentials?: Record<string, unknown>; config?: Record<string, unknown>; enabled?: boolean },
  ): Promise<CgConnector> {
    return this.http.fetchJson(`${PREFIX}/connectors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteConnector(id: string): Promise<void> {
    await this.http.fetch(`${PREFIX}/connectors/${id}`, { method: 'DELETE' })
  }

  // --- Routes ---

  async listRoutes(connector_id?: string): Promise<CgRoute[]> {
    const qs = connector_id ? `?connector_id=${connector_id}` : ''
    return this.http.fetchJson(`${PREFIX}/routes${qs}`)
  }

  async createRoute(data: {
    connector_id: string
    external_id: string
    workspace_id: string
    name?: string
    config?: Record<string, unknown>
  }): Promise<CgRoute> {
    return this.http.fetchJson(`${PREFIX}/routes`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateRoute(
    id: string,
    data: { name?: string; workspace_id?: string; config?: Record<string, unknown>; enabled?: boolean },
  ): Promise<CgRoute> {
    return this.http.fetchJson(`${PREFIX}/routes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteRoute(id: string): Promise<void> {
    await this.http.fetch(`${PREFIX}/routes/${id}`, { method: 'DELETE' })
  }

  // --- Events ---

  async listEvents(params?: {
    route_id?: string
    connector_id?: string
    limit?: number
    offset?: number
  }): Promise<{ events: CgEventLog[]; total: number }> {
    const search = new URLSearchParams()
    if (params?.route_id) search.set('route_id', params.route_id)
    if (params?.connector_id) search.set('connector_id', params.connector_id)
    if (params?.limit) search.set('limit', String(params.limit))
    if (params?.offset) search.set('offset', String(params.offset))
    const qs = search.toString()
    return this.http.fetchJson(`${PREFIX}/events${qs ? `?${qs}` : ''}`)
  }
}
