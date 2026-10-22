// Signed caller statements for MCP servers that applications declare.
//
// When a workspace calls an MCP server at an origin an application declared
// (oauth_client_mcp_origins), cp's MCP proxy attaches `X-Platform-Caller`: a
// short-lived ES256 JWT saying which user, workspace and session the call
// comes from, addressed (`aud`) to that application. The application checks it
// against the public key served at /.well-known/jwks.json, so it never has to
// trust a plain header or share a secret with the platform.
//
// The private key comes from PLATFORM_SIGNING_KEY (a PKCS#8 PEM, EC P-256),
// so operators manage and rotate it like any other secret. Without it, calls
// go out with no statement and the JWKS is empty: an application that requires
// the statement refuses the call rather than the platform vouching for nobody.

import { createHash, createPrivateKey } from 'node:crypto'
import { sign } from 'hono/jwt'

export const CALLER_HEADER = 'X-Platform-Caller'

const LIFETIME_SECONDS = 5 * 60

/** The private key as a JWK; hono/jwt writes its `alg` and `kid` into the token header. */
type SigningJwk = JsonWebKey & { alg: 'ES256'; kid: string }

let cached: SigningJwk | null | undefined

/**
 * Load PLATFORM_SIGNING_KEY once. Throws on a key that isn't EC P-256, which
 * cp calls at startup so a bad key fails the boot, not every MCP call.
 */
export function loadSigningKey(): SigningJwk | null {
  if (cached !== undefined) return cached
  const pem = process.env.PLATFORM_SIGNING_KEY
  if (!pem) {
    console.warn('[caller-assertion] PLATFORM_SIGNING_KEY is not set — MCP calls go unsigned')
    cached = null
    return cached
  }
  const privateKey = createPrivateKey(pem.replace(/\\n/g, '\n'))
  if (
    privateKey.asymmetricKeyType !== 'ec' ||
    privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
  ) {
    throw new Error('PLATFORM_SIGNING_KEY must be an EC P-256 private key')
  }
  const jwk = privateKey.export({ format: 'jwk' })
  // RFC 7638 thumbprint: stable across restarts, changes with the key.
  const kid = createHash('sha256')
    .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))
    .digest('base64url')
  cached = { ...jwk, alg: 'ES256', kid }
  return cached
}

/** The JWKS document: the current public key, or none when signing is off. */
export function jwks(): { keys: JsonWebKey[] } {
  const key = loadSigningKey()
  if (!key) return { keys: [] }
  const { kty, crv, x, y, alg, kid } = key
  return { keys: [{ kty, crv, x, y, alg, kid, use: 'sig' } as JsonWebKey] }
}

interface CallerClaims {
  /** The application the statement is for (oauth_clients.id). */
  aud: string
  /** NAP user id of the workspace owner the agent runs as. */
  sub: string
  /** The application's own id for that user, when the application provisioned it. */
  ext?: string
  workspace_id: string
  session_id?: string
}

/** Sign a caller statement, or null when no signing key is configured. */
export async function signCallerAssertion(claims: CallerClaims): Promise<string | null> {
  const key = loadSigningKey()
  if (!key) return null
  const now = Math.floor(Date.now() / 1000)
  return sign({ ...claims, iat: now, exp: now + LIFETIME_SECONDS }, key)
}
