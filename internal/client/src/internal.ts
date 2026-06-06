import type { ApiCredential, ApiWorkspaceConfig } from '../../types/api'
import type { HttpClient } from './http'

export class InternalApi {
  constructor(private http: HttpClient) {}

  async exec(
    workspaceId: string,
    command: string[],
    options?: { timeoutMs?: number },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return this.http.fetchJson(`/_cp/workspaces/${workspaceId}/exec`, {
      method: 'POST',
      body: JSON.stringify({ command, timeout_ms: options?.timeoutMs }),
    })
  }

  async getConfig(workspaceId: string): Promise<ApiWorkspaceConfig> {
    return this.http.fetchJson(`/_cp/workspaces/${workspaceId}/config`)
  }

  async updateConfig(workspaceId: string, fields: Record<string, unknown>): Promise<void> {
    await this.http.fetch(`/_cp/workspaces/${workspaceId}/config`, {
      method: 'PUT',
      body: JSON.stringify(fields),
    })
  }

  async getCredentials(workspaceId: string): Promise<ApiCredential[]> {
    return this.http.fetchJson(`/_cp/workspaces/${workspaceId}/credentials`)
  }
}
