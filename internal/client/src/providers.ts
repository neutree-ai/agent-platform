import type { ApiModelProvider } from '../../types/api'
import type { HttpClient } from './http'

export class ProvidersApi {
  constructor(private http: HttpClient) {}

  async list(): Promise<ApiModelProvider[]> {
    return this.http.fetchJson('/api/providers')
  }

  async create(params: { name: string; provider_type: string; base_url: string; api_key: string; is_public?: boolean }): Promise<ApiModelProvider> {
    return this.http.fetchJson('/api/providers', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async update(id: string, params: Partial<{ name: string; provider_type: string; base_url: string; api_key: string; is_public: boolean }>): Promise<ApiModelProvider> {
    return this.http.fetchJson(`/api/providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(params),
    })
  }

  async delete(id: string): Promise<void> {
    await this.http.fetch(`/api/providers/${id}`, { method: 'DELETE' })
  }
}
