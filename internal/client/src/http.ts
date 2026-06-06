export interface HttpClientOptions {
  baseUrl: string
  token?: string
  serviceToken?: string
}

export class HttpClient {
  private baseUrl: string
  private token: string | null
  private serviceToken: string | null

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.token = options.token ?? null
    this.serviceToken = options.serviceToken ?? null
  }

  setToken(token: string): void {
    this.token = token
  }

  async fetch(path: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {}

    // Don't set Content-Type for FormData (let browser handle boundary)
    const isFormData = init?.body instanceof FormData
    if (!isFormData) {
      headers['Content-Type'] = 'application/json'
    }

    if (this.serviceToken) {
      headers['Authorization'] = `Bearer ${this.serviceToken}`
    } else if (this.token) {
      headers['Cookie'] = `token=${this.token}`
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string>) },
    })

    if (!res.ok) {
      let detail = res.statusText
      try {
        const body = await res.json()
        if (body?.error) detail = body.error
      } catch {
        // non-JSON error response, use statusText
      }
      throw new TosApiError(res.status, detail, path)
    }

    return res
  }

  async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetch(path, init)
    return res.json()
  }
}

export class TosApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public path: string,
  ) {
    super(`NAP API ${status}: ${detail} (${path})`)
    this.name = 'TosApiError'
  }
}
