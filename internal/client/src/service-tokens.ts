import type { HttpClient } from './http'

export interface ApiServiceToken {
  id: string
  name: string
  token?: string
  created_at: string
  is_platform: boolean
}

export class ServiceTokensApi {
  constructor(private http: HttpClient) {}

  async list(): Promise<ApiServiceToken[]> {
    return this.http.fetchJson('/api/service-tokens')
  }

  async create(params: { name: string }): Promise<ApiServiceToken> {
    return this.http.fetchJson('/api/service-tokens', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async delete(id: string): Promise<void> {
    await this.http.fetch(`/api/service-tokens/${id}`, { method: 'DELETE' })
  }
}
