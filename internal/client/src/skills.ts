import type { ApiSkill, ApiSkillSource } from '../../types/api'
import type { HttpClient } from './http'

export class SkillsApi {
  constructor(private http: HttpClient) {}

  async list(): Promise<ApiSkill[]> {
    return this.http.fetchJson('/api/skills')
  }

  /**
   * Create an in-platform authored source plus its initial empty skill.
   * Requires skills-content-service to be reachable; the control plane answers
   * 502 when it is not.
   */
  async createNative(params: {
    name: string
    description: string
    visibility?: 'private' | 'public'
    category?: string | null
  }): Promise<{ source: ApiSkillSource; skill: ApiSkill }> {
    return this.http.fetchJson('/api/skills/sources/native', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async delete(id: string): Promise<void> {
    await this.http.fetch(`/api/skills/${id}`, { method: 'DELETE' })
  }

  async listSources(): Promise<ApiSkillSource[]> {
    return this.http.fetchJson('/api/skills/sources')
  }

  /** Fails while any skill still lives under the source. */
  async deleteSource(id: string): Promise<void> {
    await this.http.fetch(`/api/skills/sources/${id}`, { method: 'DELETE' })
  }
}
