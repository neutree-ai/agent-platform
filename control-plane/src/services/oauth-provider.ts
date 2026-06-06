import { createHash, randomBytes } from 'node:crypto'
import { sign } from 'hono/jwt'
import { verifyToken } from './auth'
import { pool } from './db/pool'

// ── Constants ──

const JWT_SECRET = process.env.JWT_SECRET || 'nap-jwt-secret-change-me'
const ACCESS_TOKEN_EXPIRES_IN = 60 * 60 // 1 hour
const REFRESH_TOKEN_EXPIRES_DAYS = 30
const AUTH_CODE_EXPIRES_MIN = 10

// ── Crypto helpers ──

function generateRandomToken(): string {
  return randomBytes(32).toString('hex')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function base64url(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function computeCodeChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(hash))
}

// ── Client ──

interface OAuthClient {
  id: string
  name: string
  secret_hash: string | null
  redirect_uris: string[]
  created_by: string
  created_at: string
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const { rows } = await pool.query('SELECT * FROM oauth_clients WHERE id = $1', [clientId])
  return (rows[0] as OAuthClient) ?? null
}

export function validateRedirectUri(client: OAuthClient, redirectUri: string): boolean {
  return client.redirect_uris.includes(redirectUri)
}

/** Constant-time comparison via SHA-256 hashing. Used by the token-exchange
 *  grant to verify a client's secret without leaking timing information. */
export function verifyClientSecret(client: OAuthClient, providedSecret: string): boolean {
  if (!client.secret_hash) return false
  return hashToken(providedSecret) === client.secret_hash
}

// ── Token Exchange (RFC 8693) subject-token introspection ──

interface IntrospectionResponse {
  active: boolean
  sub?: string
  client_id?: string
  scope?: string
  exp?: number
  aud?: string | string[]
}

/**
 * Validate a subject token by calling the resource server's introspection
 * endpoint (RFC 7662). The caller supplies the resource URL via the
 * token-exchange `resource` parameter; we POST to `${resource}/introspect`.
 *
 * No app-level auth on the introspect call right now — the trust model
 * rests on the unforgeability of the subject token itself (you need a
 * valid token to learn anything) plus IDC network boundary. Future:
 * register cp as a confidential client at each RS and Basic-auth this
 * call with that pair.
 */
export async function verifySubjectToken(
  subjectToken: string,
  resourceUrl: URL,
): Promise<{ userId: string; clientId: string | null } | null> {
  const url = `${resourceUrl.origin}/introspect`
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: subjectToken }).toString(),
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) {
      console.warn(`[token-exchange] introspect ${url} -> ${resp.status}`)
      return null
    }
    const data = (await resp.json()) as IntrospectionResponse
    if (!data.active || !data.sub) return null
    return { userId: data.sub, clientId: data.client_id ?? null }
  } catch (e) {
    console.warn(`[token-exchange] introspect ${url} failed:`, e)
    return null
  }
}

// ── Authorization Code ──

export async function createAuthorizationCode(params: {
  clientId: string
  userId: string
  redirectUri: string
  codeChallenge: string | null
  scope: string
}): Promise<string> {
  const code = generateRandomToken()
  const expiresAt = new Date(Date.now() + AUTH_CODE_EXPIRES_MIN * 60 * 1000)

  await pool.query(
    `INSERT INTO oauth_authorization_codes (code, client_id, user_id, redirect_uri, code_challenge, scope, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      code,
      params.clientId,
      params.userId,
      params.redirectUri,
      params.codeChallenge,
      params.scope,
      expiresAt,
    ],
  )

  return code
}

interface AuthCode {
  code: string
  client_id: string
  user_id: string
  redirect_uri: string
  code_challenge: string | null
  scope: string
  expires_at: Date
}

export async function consumeAuthorizationCode(code: string): Promise<AuthCode | null> {
  const { rows } = await pool.query(
    'DELETE FROM oauth_authorization_codes WHERE code = $1 AND expires_at > NOW() RETURNING *',
    [code],
  )
  return (rows[0] as AuthCode) ?? null
}

// ── PKCE ──

export async function verifyCodeChallenge(
  codeVerifier: string,
  codeChallenge: string,
): Promise<boolean> {
  const computed = await computeCodeChallenge(codeVerifier)
  return computed === codeChallenge
}

// ── Access Token ──

export async function issueAccessToken(user: {
  id: string
  username: string
  display_name: string
  email: string | null
  role: string
}): Promise<{ access_token: string; expires_in: number }> {
  const payload = {
    sub: user.id,
    username: user.username,
    name: user.display_name,
    email: user.email ?? undefined,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRES_IN,
  }

  const access_token = await sign(payload, JWT_SECRET)
  return { access_token, expires_in: ACCESS_TOKEN_EXPIRES_IN }
}

// ── Refresh Token ──

export async function issueRefreshToken(userId: string, clientId: string): Promise<string> {
  const token = generateRandomToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000)

  await pool.query(
    `INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [tokenHash, clientId, userId, expiresAt],
  )

  return token
}

interface RefreshTokenRecord {
  token_hash: string
  client_id: string
  user_id: string
  expires_at: Date
}

export async function consumeRefreshToken(token: string): Promise<RefreshTokenRecord | null> {
  const tokenHash = hashToken(token)
  const { rows } = await pool.query(
    'DELETE FROM oauth_refresh_tokens WHERE token_hash = $1 AND expires_at > NOW() RETURNING *',
    [tokenHash],
  )
  return (rows[0] as RefreshTokenRecord) ?? null
}

// ── User lookup ──

export async function getUserById(userId: string) {
  const { rows } = await pool.query(
    'SELECT id, username, display_name, email, role FROM users WHERE id = $1',
    [userId],
  )
  return rows[0] as
    | { id: string; username: string; display_name: string; email: string | null; role: string }
    | undefined
}

// ── Verify Bearer token (for userinfo) ──

export { verifyToken }
// ── Cleanup expired codes & tokens ──

async function cleanupExpired(): Promise<void> {
  await pool.query('DELETE FROM oauth_authorization_codes WHERE expires_at < NOW()')
  await pool.query('DELETE FROM oauth_refresh_tokens WHERE expires_at < NOW()')
}

// Run cleanup every hour
setInterval(
  () => {
    cleanupExpired().catch((err) => console.error('[oauth-provider] cleanup error:', err))
  },
  60 * 60 * 1000,
)
