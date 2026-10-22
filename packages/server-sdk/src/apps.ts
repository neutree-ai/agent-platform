// The application protocol (/apps/v1): an application registered on the
// platform provisions its own users and acts as them, with its client id and
// secret alone. Each of its users is a platform user that can't sign in to the
// platform itself.

import { NapClient, NapError } from './client.js'

export interface AppClientOptions {
  /** Platform base URL, e.g. https://nap.example.com */
  baseUrl: string
  clientId: string
  clientSecret: string
  fetch?: typeof fetch
}

export interface AppUser {
  /** The platform's user id. */
  id: string
  /** Your application's id for the user. */
  external_id: string
  username: string
  display_name: string
  email: string | null
  created_at: string
}

// A token is replaced this long before it expires, so one handed out is never
// about to lapse mid-request.
const RENEW_BEFORE_MS = 60_000

interface CachedToken {
  value: string
  expiresAt: number
}

export class AppClient {
  private readonly baseUrl: string
  private readonly authorization: string
  private readonly fetchImpl: typeof fetch
  private readonly tokens = new Map<string, CachedToken>()
  private readonly pending = new Map<string, Promise<string>>()

  constructor(private readonly options: AppClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.authorization = `Basic ${btoa(`${options.clientId}:${options.clientSecret}`)}`
    this.fetchImpl = options.fetch ?? fetch
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await this.fetchImpl(`${this.baseUrl}/apps/v1${path}`, {
      method,
      headers: {
        Authorization: this.authorization,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new NapError(
        `${method} /apps/v1${path} → ${res.status}: ${text.slice(0, 500)}`,
        res.status,
      )
    }
    return res
  }

  /**
   * Provision the user, or update its name and email. Idempotent: call it
   * whenever the user signs in to your application.
   */
  async upsertUser(
    externalId: string,
    profile: { displayName: string; email?: string | null },
  ): Promise<AppUser> {
    const res = await this.call('PUT', `/users/${encodeURIComponent(externalId)}`, {
      display_name: profile.displayName,
      email: profile.email ?? null,
    })
    return (await res.json()) as AppUser
  }

  /** Delete the user. The platform refuses while the user still owns workspaces. */
  async deleteUser(externalId: string): Promise<void> {
    await this.call('DELETE', `/users/${encodeURIComponent(externalId)}`)
    this.tokens.delete(externalId)
  }

  /** A current access token for the user, reused until shortly before it expires. */
  userToken(externalId: string): Promise<string> {
    const cached = this.tokens.get(externalId)
    if (cached && cached.expiresAt - RENEW_BEFORE_MS > Date.now()) {
      return Promise.resolve(cached.value)
    }
    // Concurrent requests for the same user share one exchange.
    let inFlight = this.pending.get(externalId)
    if (!inFlight) {
      inFlight = this.issueToken(externalId).finally(() => this.pending.delete(externalId))
      this.pending.set(externalId, inFlight)
    }
    return inFlight
  }

  private async issueToken(externalId: string): Promise<string> {
    const res = await this.call('POST', `/users/${encodeURIComponent(externalId)}/token`)
    const { access_token, expires_in } = (await res.json()) as {
      access_token: string
      expires_in: number
    }
    this.tokens.set(externalId, { value: access_token, expiresAt: Date.now() + expires_in * 1000 })
    return access_token
  }

  /** A client acting as the user; its token is renewed as needed. */
  as(externalId: string): NapClient {
    return new NapClient({
      baseUrl: this.options.baseUrl,
      token: () => this.userToken(externalId),
      fetch: this.options.fetch,
    })
  }
}
