import type { ApiTemplate, ApiTemplateVersion } from '../../types/api'
import type { HttpClient } from './http'

export class TemplatesApi {
  constructor(private http: HttpClient) {}

  async list(): Promise<ApiTemplate[]> {
    return this.http.fetchJson('/api/templates')
  }

  async get(id: string): Promise<ApiTemplate> {
    return this.http.fetchJson(`/api/templates/${id}`)
  }

  async create(params: { name: string; description?: string }): Promise<ApiTemplate> {
    return this.http.fetchJson('/api/templates', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async update(id: string, params: Partial<{ name: string; description: string }>): Promise<ApiTemplate> {
    return this.http.fetchJson(`/api/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(params),
    })
  }

  async delete(id: string): Promise<void> {
    await this.http.fetch(`/api/templates/${id}`, { method: 'DELETE' })
  }

  async listVersions(id: string): Promise<ApiTemplateVersion[]> {
    return this.http.fetchJson(`/api/templates/${id}/versions`)
  }

  async getVersion(id: string, version: number): Promise<ApiTemplateVersion> {
    return this.http.fetchJson(`/api/templates/${id}/versions/${version}`)
  }

  async createVersion(id: string, params: Record<string, unknown>): Promise<ApiTemplateVersion> {
    return this.http.fetchJson(`/api/templates/${id}/versions`, {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }
}
