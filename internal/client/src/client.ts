import { HttpClient, TosApiError } from './http'
import type { HttpClientOptions } from './http'
import { AuthApi } from './auth'
import { WorkspacesApi } from './workspaces'
import { SessionsApi } from './sessions'
import { JobsApi } from './jobs'
import { BatchRunsApi } from './batch-runs'
import { ProvidersApi } from './providers'
import { TemplatesApi } from './templates'
import { PromptsApi } from './prompts'
import { CredentialsApi } from './credentials'
import { SharesApi } from './shares'
import { TagsApi } from './tags'
import { ServiceTokensApi } from './service-tokens'
import { InternalApi } from './internal'
import { ChannelGatewayApi } from './channel-gateway'
import { AsrApi } from './asr'

export type { HttpClientOptions as TosClientOptions }

export class TosClient {
  readonly auth: AuthApi
  readonly workspaces: WorkspacesApi
  readonly sessions: SessionsApi
  readonly jobs: JobsApi
  readonly batchRuns: BatchRunsApi
  readonly providers: ProvidersApi
  readonly templates: TemplatesApi
  readonly prompts: PromptsApi
  readonly credentials: CredentialsApi
  readonly shares: SharesApi
  readonly tags: TagsApi
  readonly serviceTokens: ServiceTokensApi
  readonly internal: InternalApi
  readonly cg: ChannelGatewayApi
  readonly asr: AsrApi

  constructor(options: HttpClientOptions) {
    const http = new HttpClient(options)
    this.auth = new AuthApi(http)
    this.workspaces = new WorkspacesApi(http)
    this.sessions = new SessionsApi(http)
    this.jobs = new JobsApi(http)
    this.batchRuns = new BatchRunsApi(http)
    this.providers = new ProvidersApi(http)
    this.templates = new TemplatesApi(http)
    this.prompts = new PromptsApi(http)
    this.credentials = new CredentialsApi(http)
    this.shares = new SharesApi(http)
    this.tags = new TagsApi(http)
    this.serviceTokens = new ServiceTokensApi(http)
    this.internal = new InternalApi(http)
    this.cg = new ChannelGatewayApi(http)
    this.asr = new AsrApi(http)
  }
}

export { TosApiError }
