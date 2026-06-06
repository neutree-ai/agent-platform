import type { ApiCredentialMeta } from '../../types/api'
import type { HttpClient } from './http'

export class CredentialsApi {
  constructor(private http: HttpClient) {}

  async list(): Promise<ApiCredentialMeta[]> {
    return this.http.fetchJson('/api/credentials')
  }

  async set(name: string, value: string, inject?: string, path?: string, mode?: string): Promise<void> {
    await this.http.fetch(`/api/credentials/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ value, inject, path, mode }),
    })
  }

  async delete(name: string): Promise<void> {
    await this.http.fetch(`/api/credentials/${name}`, { method: 'DELETE' })
  }
}
