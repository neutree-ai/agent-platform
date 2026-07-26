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

    // Only declare a JSON body when there actually is one. Announcing
    // application/json on a bodyless POST makes routes with an optional body
    // try to parse an empty string and fail — e.g. POST /workspaces/:id/
    // sync-template answered 500 "Malformed JSON in request body".
    // FormData is left alone so the runtime sets its own multipart boundary.
    const isFormData = init?.body instanceof FormData
    if (init?.body !== undefined && init?.body !== null && !isFormData) {
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
      throw new NapApiError(res.status, detail, path)
    }

    return res
  }

  async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetch(path, init)
    return res.json()
  }
}

export class NapApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public path: string,
  ) {
    super(`NAP API ${status}: ${detail} (${path})`)
    this.name = 'NapApiError'
  }
}
