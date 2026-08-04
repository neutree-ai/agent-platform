import type { ApiCredential, ApiWorkspaceConfig } from '../../types/api'
import type { HttpClient } from './http'

export class InternalApi {
  constructor(private http: HttpClient) {}

  async getConfig(workspaceId: string): Promise<ApiWorkspaceConfig> {
    return this.http.fetchJson(`/_cp/workspaces/${workspaceId}/config`)
  }

  async getCredentials(workspaceId: string): Promise<ApiCredential[]> {
    return this.http.fetchJson(`/_cp/workspaces/${workspaceId}/credentials`)
  }
}
