import { pool } from './db/pool'

// ── Types ──

interface OAuthMetadata {
  issuer?: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  scopes_supported?: string[]
  response_types_supported?: string[]
  grant_types_supported?: string[]
  [key: string]: unknown
}

interface OAuthClient {
  server_origin: string
  metadata: OAuthMetadata
  client_id: string
  client_secret: string | null
}

interface OAuthToken {
  user_id: string
  server_origin: string
  access_token: string
  refresh_token: string | null
  token_type: string
  scope: string | null
  expires_at: Date | null
  updated_at: Date
  refresh_fail_count: number
  refresh_fail_first_at: Date | null
}

// Fallback TTL when the OAuth provider doesn't return `expires_in` (e.g.
// Salesforce). Conservative: SF default session is 2h but admins can shorten
// it; refreshing every ~30min is cheap and avoids stale-token 401s.
const DEFAULT_TOKEN_TTL_SECONDS = 1800

// How long before expiry we start refreshing proactively. Must exceed
// google-auth's REFRESH_THRESHOLD (3m45s): clients built on it treat a token
// as already expired that far ahead of the wire expiry, so anything we serve
// must have more life left than that.
const REFRESH_MARGIN_MS = 5 * 60 * 1000

/**
 * Classify a stored token by remaining life. OAuth-proxy MCP servers mint
 * their access token together with the upstream provider token, and
 * google-auth style clients refuse a token in its final 3m45s — serving a
 * nearly-expired token makes every downstream call fail until it rotates.
 * `refresh-ahead` marks the window where the token still works but must be
 * refreshed rather than served as-is.
 */
export function classifyTokenLife(msLeft: number): 'fresh' | 'refresh-ahead' | 'expired' {
  if (msLeft <= 0) return 'expired'
  return msLeft > REFRESH_MARGIN_MS ? 'fresh' : 'refresh-ahead'
}

// In-memory store for pending PKCE flows (keyed by state)
interface PendingAuth {
  user_id: string
  server_origin: string
  code_verifier: string
  workspace_id: string
  created_at: number
}

const pendingAuths = new Map<string, PendingAuth>()

// Clean up stale entries (> 10 min) periodically
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000
  for (const [key, val] of pendingAuths) {
    if (val.created_at < cutoff) pendingAuths.delete(key)
  }
}, 60 * 1000)

// ── PKCE helpers ──

function generateCodeVerifier(): string {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(hash))
}

function base64url(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function generateState(): string {
  const buf = new Uint8Array(16)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

// ── Discovery ──

/** Extract origin from MCP server URL (strip path) */
export function serverOriginFromUrl(url: string): string {
  const u = new URL(url)
  return u.origin
}

/** Discover OAuth metadata for an MCP server. */
export async function discoverOAuthMetadata(
  serverUrl: string,
): Promise<
  | { status: 'oauth'; origin: string; metadata: OAuthMetadata }
  | { status: 'none' }
  | { status: 'error'; message: string }
> {
  const origin = serverOriginFromUrl(serverUrl)
  const metadataUrl = `${origin}/.well-known/oauth-authorization-server`
  try {
    const resp = await fetch(metadataUrl, {
      headers: { 'MCP-Protocol-Version': '2025-03-26' },
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) return { status: 'none' }
    const contentType = resp.headers.get('content-type') ?? ''
    if (!contentType.includes('json')) return { status: 'none' }
    const metadata = (await resp.json()) as OAuthMetadata
    if (!metadata.authorization_endpoint || !metadata.token_endpoint) return { status: 'none' }
    return { status: 'oauth', origin, metadata }
  } catch (e: any) {
    return { status: 'error', message: e?.message ?? 'Discovery failed' }
  }
}

// ── Client Registration ──

/** Get existing client or register a new one via Dynamic Client Registration */
export async function getOrRegisterClient(
  origin: string,
  metadata: OAuthMetadata,
  callbackUrl: string,
): Promise<OAuthClient> {
  // Check DB first
  const { rows } = await pool.query(
    'SELECT server_origin, metadata, client_id, client_secret FROM mcp_oauth_clients WHERE server_origin = $1',
    [origin],
  )
  if (rows.length > 0) {
    return rows[0] as OAuthClient
  }

  // Try dynamic client registration
  if (metadata.registration_endpoint) {
    const regBody = {
      redirect_uris: [callbackUrl],
      grant_types: metadata.grant_types_supported ?? ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_name: 'NAP Platform',
    }
    const resp = await fetch(metadata.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regBody),
    })
    if (resp.ok) {
      const reg = (await resp.json()) as { client_id: string; client_secret?: string }
      await pool.query(
        `INSERT INTO mcp_oauth_clients (server_origin, metadata, client_id, client_secret)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (server_origin) DO UPDATE SET metadata = $2, client_id = $3, client_secret = $4, updated_at = NOW()`,
        [origin, JSON.stringify(metadata), reg.client_id, reg.client_secret ?? null],
      )
      return {
        server_origin: origin,
        metadata,
        client_id: reg.client_id,
        client_secret: reg.client_secret ?? null,
      }
    }
  }

  throw new Error(
    `Cannot register OAuth client for ${origin}: no registration endpoint or registration failed`,
  )
}

// ── Authorization URL ──

/** Build authorization URL and store pending PKCE state. Returns { url, state }. */
export async function buildAuthorizationUrl(
  client: OAuthClient,
  userId: string,
  workspaceId: string,
  callbackUrl: string,
): Promise<{ url: string; state: string }> {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = generateState()

  pendingAuths.set(state, {
    user_id: userId,
    server_origin: client.server_origin,
    code_verifier: codeVerifier,
    workspace_id: workspaceId,
    created_at: Date.now(),
  })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: callbackUrl,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  })

  const authEndpoint = client.metadata.authorization_endpoint
  const url = `${authEndpoint}${authEndpoint.includes('?') ? '&' : '?'}${params}`
  return { url, state }
}

/** Retrieve and consume pending auth state */
export function consumePendingAuth(state: string): PendingAuth | null {
  const pending = pendingAuths.get(state)
  if (!pending) return null
  pendingAuths.delete(state)
  return pending
}

// ── Token Exchange ──

/** Exchange authorization code for tokens */
export async function exchangeCodeForToken(
  client: OAuthClient,
  code: string,
  codeVerifier: string,
  callbackUrl: string,
): Promise<{
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in?: number
  scope?: string
}> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl,
    client_id: client.client_id,
    code_verifier: codeVerifier,
  })
  if (client.client_secret) {
    body.set('client_secret', client.client_secret)
  }

  const resp = await fetch(client.metadata.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Token exchange failed (${resp.status}): ${text}`)
  }
  return resp.json()
}

// OAuth 2.0 errors that mean the refresh_token / client are permanently dead
// and the user must re-authorize. Anything else (5xx, network) is treated as
// transient and left for the next retry.
const PERMANENT_OAUTH_ERRORS = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client'])

// A "permanent" OAuth code is not always permanent: upstream MCP brokers
// surface a *transient* failure to refresh the underlying provider token (e.g.
// a TLS UNEXPECTED_EOF to googleapis.com) as `invalid_grant`. Rather than drop
// the token row on the first such error, we hold it through a grace window and
// only drop + prompt re-auth once refresh has kept failing across multiple
// requests spanning at least this long. A genuinely dead token keeps failing
// and gets cleaned up; a transient one heals on a later request and resets the
// counter via `upsertToken`.
const REFRESH_FAIL_GRACE_SECONDS = 600
const REFRESH_FAIL_MIN_COUNT = 3

/**
 * Decide whether persistent refresh failures warrant dropping the stored token
 * and prompting the user to re-authorize. Requires both a minimum number of
 * consecutive failures and that the first failure is older than the grace
 * window, so a short-lived network blip (which resets the counter once it
 * heals) never escalates to a re-auth prompt. Pure — unit-testable without a DB.
 */
export function shouldDropTokenOnRefreshFailure(
  failCount: number,
  firstFailAt: Date | null,
  now: Date,
): boolean {
  if (firstFailAt === null) return false
  const elapsedMs = now.getTime() - firstFailAt.getTime()
  return failCount >= REFRESH_FAIL_MIN_COUNT && elapsedMs >= REFRESH_FAIL_GRACE_SECONDS * 1000
}

class McpRefreshError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly oauthError: string | null,
    readonly permanent: boolean,
  ) {
    super(message)
    this.name = 'McpRefreshError'
  }
}

/** Thrown by `getValidAccessToken` when the stored token is permanently dead.
 *  Caller should surface a "reconnect this MCP server" prompt to the user. */
export class McpOAuthReauthRequired extends Error {
  constructor(
    readonly serverOrigin: string,
    readonly oauthError: string | null,
  ) {
    super(`MCP OAuth reauthorization required for ${serverOrigin}`)
    this.name = 'McpOAuthReauthRequired'
  }
}

/** Refresh an access token */
async function refreshAccessToken(
  client: OAuthClient,
  refreshToken: string,
): Promise<{
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in?: number
  scope?: string
}> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.client_id,
  })
  if (client.client_secret) {
    body.set('client_secret', client.client_secret)
  }

  const resp = await fetch(client.metadata.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!resp.ok) {
    let oauthError: string | null = null
    try {
      const text = await resp.text()
      const parsed = JSON.parse(text) as { error?: string; error_description?: string }
      oauthError = parsed?.error ?? null
    } catch {
      // body isn't JSON — leave oauthError null, treat by status code
    }
    // 4xx without a recognizable transient code → assume the refresh_token /
    // client is dead. 5xx is transient.
    const permanent =
      (oauthError !== null && PERMANENT_OAUTH_ERRORS.has(oauthError)) ||
      (resp.status >= 400 && resp.status < 500 && oauthError === null)
    throw new McpRefreshError(
      `Token refresh failed: ${resp.status}${oauthError ? ` (${oauthError})` : ''}`,
      resp.status,
      oauthError,
      permanent,
    )
  }
  return resp.json()
}

// ── Token CRUD ──

export async function upsertToken(
  userId: string,
  serverOrigin: string,
  token: {
    access_token: string
    refresh_token?: string
    token_type?: string
    expires_in?: number
    scope?: string
  },
): Promise<void> {
  const ttlSeconds = token.expires_in ?? DEFAULT_TOKEN_TTL_SECONDS
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
  await pool.query(
    `INSERT INTO mcp_oauth_tokens (user_id, server_origin, access_token, refresh_token, token_type, scope, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, server_origin) DO UPDATE SET
       access_token = $3, refresh_token = COALESCE($4, mcp_oauth_tokens.refresh_token),
       token_type = $5, scope = $6, expires_at = $7, updated_at = NOW(),
       refresh_fail_count = 0, refresh_fail_first_at = NULL`,
    [
      userId,
      serverOrigin,
      token.access_token,
      token.refresh_token ?? null,
      token.token_type ?? 'Bearer',
      token.scope ?? null,
      expiresAt,
    ],
  )
}

export async function getToken(userId: string, serverOrigin: string): Promise<OAuthToken | null> {
  const { rows } = await pool.query(
    'SELECT * FROM mcp_oauth_tokens WHERE user_id = $1 AND server_origin = $2',
    [userId, serverOrigin],
  )
  return rows[0] ?? null
}

/**
 * Increment the consecutive refresh-failure counter for a token, stamping the
 * time of the first failure in the current streak. Returns the running count
 * and first-failure timestamp so the caller can decide whether the failures
 * have persisted past the grace window. A successful refresh resets both via
 * `upsertToken`.
 */
async function recordRefreshFailure(
  userId: string,
  serverOrigin: string,
): Promise<{ failCount: number; firstFailAt: Date | null }> {
  const { rows } = await pool.query(
    `UPDATE mcp_oauth_tokens
       SET refresh_fail_count = refresh_fail_count + 1,
           refresh_fail_first_at = COALESCE(refresh_fail_first_at, NOW())
     WHERE user_id = $1 AND server_origin = $2
     RETURNING refresh_fail_count, refresh_fail_first_at`,
    [userId, serverOrigin],
  )
  const row = rows[0]
  if (!row) return { failCount: 0, firstFailAt: null }
  return { failCount: row.refresh_fail_count, firstFailAt: row.refresh_fail_first_at }
}

export async function deleteToken(userId: string, serverOrigin: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM mcp_oauth_tokens WHERE user_id = $1 AND server_origin = $2',
    [userId, serverOrigin],
  )
  return (rowCount ?? 0) > 0
}

export async function listTokensForUser(userId: string): Promise<OAuthToken[]> {
  const { rows } = await pool.query('SELECT * FROM mcp_oauth_tokens WHERE user_id = $1', [userId])
  return rows
}

// ── High-level: get valid token (with auto-refresh) ──

/**
 * Get a valid access token, refreshing if expired. Returns null if no token or
 * refresh fails.
 *
 * `forceRefresh` skips the local expiry check and refreshes unconditionally —
 * used when an upstream 401 proves the stored token is invalid even though cp
 * still considers it within its TTL (clock skew, upstream session shorter than
 * the advertised expires_in, revocation).
 */
export async function getValidAccessToken(
  userId: string,
  serverOrigin: string,
  forceRefresh = false,
): Promise<string | null> {
  const token = await getToken(userId, serverOrigin)
  if (!token) return null

  // Effective expiry: use stored expires_at, else fall back to updated_at + TTL.
  // Older rows predating the fallback default may have NULL expires_at; treat
  // those as expired once they're past the fallback window so refresh kicks in.
  const effectiveExpiresAt =
    token.expires_at ??
    new Date(new Date(token.updated_at).getTime() + DEFAULT_TOKEN_TTL_SECONDS * 1000)
  const msLeft = effectiveExpiresAt.getTime() - Date.now()
  const life = classifyTokenLife(msLeft)

  if (!forceRefresh && life === 'fresh') {
    return token.access_token
  }
  const stillValid = life !== 'expired'

  // Try refresh
  if (!token.refresh_token) return stillValid ? token.access_token : null
  const { rows: clientRows } = await pool.query(
    'SELECT server_origin, metadata, client_id, client_secret FROM mcp_oauth_clients WHERE server_origin = $1',
    [serverOrigin],
  )
  if (clientRows.length === 0) return stillValid ? token.access_token : null
  const client = clientRows[0] as OAuthClient

  try {
    const refreshed = await refreshAccessToken(client, token.refresh_token)
    await upsertToken(userId, serverOrigin, refreshed)
    return refreshed.access_token
  } catch (e) {
    // A proactive (within-margin) refresh failure is not fatal while the
    // current token is still valid: serve it and let a later request retry.
    // forceRefresh callers are excluded — they hold proof the token is bad.
    if (stillValid && !forceRefresh) {
      console.warn(
        `[mcp-oauth] proactive refresh failed for ${serverOrigin}; serving still-valid token (${Math.round(msLeft / 1000)}s left):`,
        e instanceof Error ? e.message : e,
      )
      return token.access_token
    }
    if (e instanceof McpRefreshError && e.permanent) {
      // A "permanent" OAuth code may actually be an upstream transient (a TLS
      // blip while the broker refreshes the provider token, reported back as
      // `invalid_grant`). Don't drop the row on the first failure — hold it
      // through a grace window so a network hiccup doesn't force the user to
      // re-OAuth. Only once refresh keeps failing across multiple requests
      // spanning the window do we drop the row (so we stop hammering the broker)
      // and signal the caller to prompt re-auth.
      const { failCount, firstFailAt } = await recordRefreshFailure(userId, serverOrigin)
      if (shouldDropTokenOnRefreshFailure(failCount, firstFailAt, new Date())) {
        await deleteToken(userId, serverOrigin)
        console.warn(
          `[mcp-oauth] dropped dead token for ${serverOrigin} after ${failCount} refresh failures over grace window (oauth_error=${e.oauthError ?? 'none'}, status=${e.status})`,
        )
        throw new McpOAuthReauthRequired(serverOrigin, e.oauthError)
      }
      // Within the grace window: keep the token and treat as transient so the
      // next request retries the refresh. The agent sees a transient auth error
      // but self-heals once the upstream blip clears.
      console.warn(
        `[mcp-oauth] holding token for ${serverOrigin} through grace window (refresh failure ${failCount}, oauth_error=${e.oauthError ?? 'none'}, status=${e.status}); treating as transient`,
      )
      return null
    }
    console.error(`[mcp-oauth] refresh failed (transient) for ${serverOrigin}:`, e)
    return null
  }
}
