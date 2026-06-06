import type { ApiTag } from '../../types/api'
import type { HttpClient } from './http'

export class TagsApi {
  constructor(private http: HttpClient) {}

  async list(): Promise<ApiTag[]> {
    return this.http.fetchJson('/api/tags')
  }

  async create(params: { name: string; color?: string }): Promise<ApiTag> {
    return this.http.fetchJson('/api/tags', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async update(id: string, params: Partial<{ name: string; color: string }>): Promise<ApiTag> {
    return this.http.fetchJson(`/api/tags/${id}`, {
      method: 'PUT',
      body: JSON.stringify(params),
    })
  }

  async delete(id: string): Promise<void> {
    await this.http.fetch(`/api/tags/${id}`, { method: 'DELETE' })
  }

  async setWorkspaceTags(workspaceId: string, tagIds: string[]): Promise<void> {
    await this.http.fetch(`/api/tags/workspace/${workspaceId}`, {
      method: 'PUT',
      body: JSON.stringify({ tag_ids: tagIds }),
    })
  }
}
