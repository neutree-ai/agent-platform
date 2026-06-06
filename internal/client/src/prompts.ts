import type { ApiPrompt, ApiPromptVersion } from '../../types/api'
import type { HttpClient } from './http'

export class PromptsApi {
  constructor(private http: HttpClient) {}

  async list(): Promise<ApiPrompt[]> {
    return this.http.fetchJson('/api/prompts')
  }

  async listPublic(): Promise<ApiPrompt[]> {
    return this.http.fetchJson('/api/prompts/public')
  }

  async get(id: string): Promise<ApiPrompt> {
    return this.http.fetchJson(`/api/prompts/${id}`)
  }

  async create(params: { name: string; content: string; is_public?: boolean }): Promise<ApiPrompt> {
    return this.http.fetchJson('/api/prompts', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async update(id: string, params: Partial<{ name: string; content: string; is_public: boolean }>): Promise<ApiPrompt> {
    return this.http.fetchJson(`/api/prompts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(params),
    })
  }

  async delete(id: string): Promise<void> {
    await this.http.fetch(`/api/prompts/${id}`, { method: 'DELETE' })
  }

  async listVersions(id: string): Promise<ApiPromptVersion[]> {
    return this.http.fetchJson(`/api/prompts/${id}/versions`)
  }

  async rollback(id: string): Promise<ApiPrompt> {
    return this.http.fetchJson(`/api/prompts/${id}/rollback`, {
      method: 'POST',
    })
  }
}
