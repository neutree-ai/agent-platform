import type { ApiK8sStatus, ApiWorkspace, ApiWorkspaceConfig, ComputeResources } from '../../types/api'
import type { HttpClient } from './http'

export class WorkspacesApi {
  constructor(private http: HttpClient) {}

  async list(options?: { search?: string; limit?: number; tag?: string }): Promise<ApiWorkspace[]> {
    const params = new URLSearchParams()
    if (options?.search) params.set('search', options.search)
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.tag) params.set('tag', options.tag)
    const qs = params.toString()
    return this.http.fetchJson(`/api/workspaces${qs ? `?${qs}` : ''}`)
  }

  async create(params: { name: string; agentType?: string; computeResources?: ComputeResources; templateId?: string }): Promise<ApiWorkspace> {
    return this.http.fetchJson('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async rename(id: string, name: string): Promise<void> {
    await this.http.fetch(`/api/workspaces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
  }

  async delete(id: string): Promise<void> {
    await this.http.fetch(`/api/workspaces/${id}`, { method: 'DELETE' })
  }

  async status(id: string): Promise<ApiK8sStatus> {
    return this.http.fetchJson(`/api/workspaces/${id}/status`)
  }

  async start(id: string): Promise<void> {
    await this.http.fetch(`/api/workspaces/${id}/start`, { method: 'POST' })
  }

  async stop(id: string): Promise<void> {
    await this.http.fetch(`/api/workspaces/${id}/stop`, { method: 'POST' })
  }

  async interrupt(id: string): Promise<void> {
    await this.http.fetch(`/api/workspaces/${id}/interrupt`, { method: 'POST' })
  }

  async restart(id: string): Promise<void> {
    await this.http.fetch(`/api/workspaces/${id}/restart`, { method: 'POST' })
  }

  async syncTemplate(id: string): Promise<void> {
    await this.http.fetch(`/api/workspaces/${id}/sync-template`, { method: 'POST' })
  }

  async getConfig(id: string): Promise<ApiWorkspaceConfig> {
    return this.http.fetchJson(`/api/workspaces/${id}/config`)
  }

  async updateConfig(id: string, fields: Record<string, unknown>): Promise<void> {
    await this.http.fetch(`/api/workspaces/${id}/config`, {
      method: 'PUT',
      body: JSON.stringify(fields),
    })
  }

  async seen(id: string, sessionId?: string): Promise<void> {
    await this.http.fetch(`/api/workspaces/${id}/seen`, {
      method: 'POST',
      body: JSON.stringify(sessionId ? { sessionId } : {}),
    })
  }
}
