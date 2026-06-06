import type {
  SandboxInfo,
  CreateOptions,
  ListFilter,
  ExecOptions,
  CommandResult,
  WriteFileEntry,
} from './types'

export interface SandboxClientOptions {
  /** Sandbox service base URL, e.g. `https://sandbox.example.com`. Required. */
  baseUrl: string
  token: string
}

export class SandboxApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public path: string,
  ) {
    super(`Sandbox API ${status}: ${detail} (${path})`)
    this.name = 'SandboxApiError'
  }
}

export class SandboxClient {
  private readonly baseUrl: string
  private readonly token: string

  constructor(opts: SandboxClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '')
    this.token = opts.token
  }

  // ---- HTTP helpers ----

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...(init?.headers as Record<string, string>),
      },
    })
    if (!res.ok) {
      let detail = res.statusText
      try {
        const body = await res.json()
        if (body?.error) detail = body.error
      } catch {
        // non-JSON error response
      }
      throw new SandboxApiError(res.status, detail, path)
    }
    return res
  }

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetch(path, init)
    return res.json()
  }

  // ---- Lifecycle ----

  async create(opts: CreateOptions): Promise<SandboxInfo> {
    return this.fetchJson('/api/sandboxes', {
      method: 'POST',
      body: JSON.stringify(opts),
    })
  }

  async list(filter?: ListFilter): Promise<{ items: SandboxInfo[] }> {
    const params = new URLSearchParams()
    if (filter?.metadata) {
      for (const [k, v] of Object.entries(filter.metadata)) {
        params.set(`metadata.${k}`, v)
      }
    }
    const qs = params.toString()
    return this.fetchJson(`/sandboxes${qs ? `?${qs}` : ''}`)
  }

  async get(id: string): Promise<SandboxInfo> {
    return this.fetchJson(`/sandboxes/${id}`)
  }

  async delete(id: string): Promise<void> {
    await this.fetch(`/sandboxes/${id}`, { method: 'DELETE' })
  }

  async renew(id: string, timeoutSeconds: number): Promise<{ expiresAt: string }> {
    return this.fetchJson(`/sandboxes/${id}/renew`, {
      method: 'POST',
      body: JSON.stringify({ timeoutSeconds }),
    })
  }

  // ---- Execution ----

  async exec(id: string, command: string, opts?: ExecOptions): Promise<CommandResult> {
    return this.fetchJson(`/sandboxes/${id}/exec`, {
      method: 'POST',
      body: JSON.stringify({ command, ...opts }),
    })
  }

  // ---- Files ----

  async readFile(id: string, path: string): Promise<string> {
    const res = await this.fetch(
      `/sandboxes/${id}/files?path=${encodeURIComponent(path)}`,
    )
    const body = await res.json() as { content: string }
    return body.content
  }

  async writeFiles(id: string, files: WriteFileEntry[]): Promise<void> {
    await this.fetch(`/sandboxes/${id}/files`, {
      method: 'POST',
      body: JSON.stringify({ files }),
    })
  }

  // ---- Endpoint ----

  async getEndpointUrl(id: string, port: number): Promise<string> {
    const body = await this.fetchJson<{ url: string }>(
      `/sandboxes/${id}/endpoint/${port}`,
    )
    return body.url
  }

  /** Build the subdomain preview URL (no network call). */
  getPreviewUrl(id: string, port: number): string {
    const base = new URL(this.baseUrl)
    return `${base.protocol}//${id}-${port}.${base.host}/`
  }
}
