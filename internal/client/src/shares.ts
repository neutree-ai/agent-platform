import type { HttpClient } from './http'

export interface ApiShare {
  id: string
  url?: string
  title?: string
  created_at?: string
  [key: string]: unknown
}

export interface ApiShareData {
  title?: string
  workspaceConfig: unknown
  messages: unknown[]
  chunks: unknown[]
  [key: string]: unknown
}

export class SharesApi {
  constructor(private http: HttpClient) {}

  async list(params: { workspace_id: string; session_id: string }): Promise<ApiShare[]> {
    return this.http.fetchJson(`/api/shares?workspace_id=${params.workspace_id}&session_id=${params.session_id}`)
  }

  async create(params: { workspace_id: string; session_id?: string; title?: string }): Promise<ApiShare> {
    return this.http.fetchJson('/api/shares', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async update(id: string, params: Record<string, unknown>): Promise<void> {
    await this.http.fetch(`/api/shares/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    })
  }

  async delete(id: string): Promise<void> {
    await this.http.fetch(`/api/shares/${id}`, { method: 'DELETE' })
  }

  async getPublic(id: string): Promise<ApiShareData> {
    return this.http.fetchJson(`/api/shares/public/${id}`)
  }
}
