// The platform's caller statement. When a workspace calls an MCP server your
// application declared (its mcp_origins), the platform's MCP proxy adds
// `X-Platform-Caller`: a five-minute ES256 JWT, addressed to your application,
// naming who is calling. Verify it here instead of trusting any plain header —
// an agent can reach your server directly and send whatever headers it likes.

export const CALLER_HEADER = 'X-Platform-Caller'

export interface Caller {
  /** Platform user id of the workspace owner the agent runs as. */
  userId: string
  /** Your application's id for that user, when your application provisioned it. */
  externalId?: string
  workspaceId: string
  /** The session the call comes from, when the platform could tell. */
  sessionId?: string
}

export interface CallerVerifierOptions {
  /** Platform base URL; the public keys are read from its /.well-known/jwks.json. */
  baseUrl: string
  /** Your application's client id: statements addressed elsewhere are refused. */
  clientId: string
  fetch?: typeof fetch
}

interface Claims {
  aud?: unknown
  sub?: unknown
  ext?: unknown
  workspace_id?: unknown
  session_id?: unknown
  exp?: unknown
}

// Tolerated clock difference between the platform and this server.
const SKEW_SECONDS = 30
// An unknown key id triggers a JWKS refetch at most this often, so forged
// tokens can't make every request a round trip to the platform.
const REFETCH_INTERVAL_MS = 60_000

const decoder = new TextDecoder()

function fromBase64url(part: string): Uint8Array {
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

function decodeJson(part: string): unknown {
  try {
    return JSON.parse(decoder.decode(fromBase64url(part)))
  } catch {
    return null
  }
}

export class CallerVerifier {
  private readonly jwksUrl: string
  private readonly fetchImpl: typeof fetch
  private keys = new Map<string, Promise<CryptoKey>>()
  private loaded: Promise<void> | null = null
  private lastFetch = 0

  constructor(private readonly options: CallerVerifierOptions) {
    this.jwksUrl = `${options.baseUrl.replace(/\/+$/, '')}/.well-known/jwks.json`
    this.fetchImpl = options.fetch ?? fetch
  }

  private refreshKeys(): Promise<void> {
    this.lastFetch = Date.now()
    this.loaded = (async () => {
      const res = await this.fetchImpl(this.jwksUrl)
      if (!res.ok) throw new Error(`GET ${this.jwksUrl} → ${res.status}`)
      const { keys } = (await res.json()) as { keys: (JsonWebKey & { kid?: string })[] }
      const next = new Map<string, Promise<CryptoKey>>()
      for (const jwk of keys) {
        if (!jwk.kid || jwk.kty !== 'EC' || jwk.crv !== 'P-256') continue
        next.set(
          jwk.kid,
          crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
            'verify',
          ]),
        )
      }
      this.keys = next
    })()
    // A failed fetch is retried by the next statement rather than cached.
    this.loaded.catch(() => {
      this.loaded = null
    })
    return this.loaded
  }

  private async key(kid: string): Promise<CryptoKey | undefined> {
    await (this.loaded ?? this.refreshKeys())
    if (!this.keys.has(kid) && Date.now() - this.lastFetch > REFETCH_INTERVAL_MS) {
      // The platform may have rotated its key since the last fetch.
      await this.refreshKeys()
    }
    return this.keys.get(kid)
  }

  /**
   * The caller a request's statement names, or null when there is none or it
   * doesn't verify: not signed by the platform, expired, or not for you.
   */
  async verify(request: Request | Headers): Promise<Caller | null> {
    const headers = request instanceof Headers ? request : request.headers
    const token = headers.get(CALLER_HEADER)
    if (!token) return null
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [headerPart, payloadPart, signaturePart] = parts

    const header = decodeJson(headerPart) as { alg?: unknown; kid?: unknown } | null
    if (header?.alg !== 'ES256' || typeof header.kid !== 'string') return null
    const key = await this.key(header.kid)
    if (!key) return null

    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      fromBase64url(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    )
    if (!valid) return null

    const claims = decodeJson(payloadPart) as Claims | null
    if (!claims || claims.aud !== this.options.clientId) return null
    if (typeof claims.exp !== 'number' || claims.exp + SKEW_SECONDS < Date.now() / 1000) {
      return null
    }
    if (typeof claims.sub !== 'string' || typeof claims.workspace_id !== 'string') return null
    return {
      userId: claims.sub,
      workspaceId: claims.workspace_id,
      ...(typeof claims.ext === 'string' && { externalId: claims.ext }),
      ...(typeof claims.session_id === 'string' && { sessionId: claims.session_id }),
    }
  }
}
