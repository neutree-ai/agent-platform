// NAP OAuth client — shared scaffolding for services that act as OAuth
// consumers of the NAP control plane. Provides config, PKCE helpers, JWT
// session tokens, the /api/auth/{login,callback,me,logout} routes, and a
// session-cookie middleware. See forum/ and sandbox-service/ for usage.

// Hono is intentionally imported for runtime use only. Each consumer service
// has its own copy of hono in node_modules, and TS sees them as distinct nominal
// types — exposing Hono/MiddlewareHandler types across the package boundary
// causes spurious type-id mismatches. We export the router and middleware
// typed as `unknown`-friendly shapes; consumers cast through their own hono.
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'

export interface OAuthUserInfo {
  sub: string
  username: string
  name: string
  email?: string
}

/**
 * Raw token response from the control-plane `authorization_code` grant. Passed
 * to `onLogin` so a consumer can persist a refresh token for later background
 * use (acting as the user outside a live request). Most services ignore this.
 */
export interface OAuthTokens {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

export interface SessionPayload {
  sub: string
  username: string
  name: string
  exp: number
  [key: string]: unknown
}

export interface OAuthClientOptions {
  /** OAuth client_id registered in the cp Applications table. */
  clientId: string
  /** Public base URL of this service (used for the OAuth redirect_uri). */
  serviceUrl: string
  /** NAP control-plane base URL. Defaults to NAP_OAUTH_URL env. */
  napUrl?: string
  /** Cookie name for the session token. */
  cookieName: string
  /** HMAC secret for the session JWT. */
  jwtSecret: string
  /** Session lifetime in seconds. Defaults to 7 days. */
  jwtExpiresIn?: number
  /** Whether to mark the session cookie Secure. Defaults to false. */
  cookieSecure?: boolean
  /**
   * Hook fired after a successful OAuth callback, before the cookie is set.
   * Receives the userinfo and (additively) the raw token response — a consumer
   * that needs to act as the user later can persist `tokens.refresh_token`.
   */
  onLogin?: (userinfo: OAuthUserInfo, tokens: OAuthTokens) => Promise<void> | void
  /**
   * Optional Bearer-token verifier. When set, `sessionMiddleware` accepts
   * `Authorization: Bearer <token>` as a fallback to the session cookie —
   * intended for cp-issued service tokens (see `service_tokens` table).
   * Return a SessionPayload to authenticate, or null to fall through to 401.
   */
  verifyBearerToken?: (token: string) => Promise<SessionPayload | null>
}

export interface OAuthClient {
  config: {
    clientId: string
    serviceUrl: string
    napUrl: string
    cookieName: string
    callbackUrl: string
    authorizeUrl: string
    tokenUrl: string
    userinfoUrl: string
  }
  createSessionToken(user: { id: string; username: string; display_name: string }): Promise<string>
  verifySessionToken(token: string): Promise<SessionPayload | null>
  /**
   * Hono router with /login, /callback, /me, /logout. Mount at /api/auth.
   * Typed as `any` to avoid nominal type mismatch when consumers and this
   * package each have their own copy of hono in node_modules.
   */
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  authRoutes: any
  /**
   * Hono router with only /login and /callback. Useful when a consumer wants
   * to keep custom /me and /logout (e.g. wrapped in OpenAPIHono with schemas).
   */
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  redirectRoutes: any
  /** Middleware that reads the session cookie, sets c.var.user, or returns 401. */
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  sessionMiddleware(): any
}

function base64url(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function generateCodeVerifier(): string {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(hash))
}

function generateState(): string {
  const buf = new Uint8Array(16)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

export function createOAuthClient(opts: OAuthClientOptions): OAuthClient {
  const napUrl = opts.napUrl ?? process.env.NAP_OAUTH_URL ?? 'http://localhost:3000'
  const expiresIn = opts.jwtExpiresIn ?? 60 * 60 * 24 * 7
  const cookieSecure = opts.cookieSecure ?? false

  const config = {
    clientId: opts.clientId,
    serviceUrl: opts.serviceUrl,
    napUrl,
    cookieName: opts.cookieName,
    callbackUrl: `${opts.serviceUrl}/api/auth/callback`,
    authorizeUrl: `${napUrl}/oauth/authorize`,
    tokenUrl: `${napUrl}/api/oauth/token`,
    userinfoUrl: `${napUrl}/api/oauth/userinfo`,
  }

  // PKCE state store. Per-client instance so multiple clients can coexist.
  // `next` is an optional post-login return path that /login can stash so
  // callers (e.g. a service's own /oauth/consent that needs the user logged
  // in before continuing) can bounce through the login and land back where
  // they started, instead of dumping the user at `/`.
  const pendingOAuth = new Map<
    string,
    { codeVerifier: string; createdAt: number; next?: string }
  >()
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000
    for (const [k, v] of pendingOAuth) if (v.createdAt < cutoff) pendingOAuth.delete(k)
  }, 60 * 1000)

  /** Accept only same-host absolute paths so a forged `next` can't redirect
   *  the user off-service after a successful login. */
  function sanitizeNext(raw: string | undefined): string | undefined {
    if (!raw) return undefined
    if (!raw.startsWith('/') || raw.startsWith('//')) return undefined
    return raw
  }

  async function createSessionToken(user: {
    id: string
    username: string
    display_name: string
  }): Promise<string> {
    const payload: SessionPayload = {
      sub: user.id,
      username: user.username,
      name: user.display_name,
      exp: Math.floor(Date.now() / 1000) + expiresIn,
    }
    return await sign(payload, opts.jwtSecret)
  }

  async function verifySessionToken(token: string): Promise<SessionPayload | null> {
    try {
      return (await verify(token, opts.jwtSecret, 'HS256')) as SessionPayload
    } catch {
      return null
    }
  }

  const redirectRoutes = new Hono()

  redirectRoutes.get('/login', async (c) => {
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = await generateCodeChallenge(codeVerifier)
    const state = generateState()
    const next = sanitizeNext(c.req.query('next'))
    pendingOAuth.set(state, { codeVerifier, createdAt: Date.now(), next })

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      scope: 'profile',
    })
    return c.redirect(`${config.authorizeUrl}?${params.toString()}`)
  })

  redirectRoutes.get('/callback', async (c) => {
    const code = c.req.query('code')
    const state = c.req.query('state')
    const error = c.req.query('error')

    if (error) return c.redirect(`/?error=${error}`)
    if (!code || !state) return c.redirect('/?error=invalid_callback')

    const entry = pendingOAuth.get(state)
    if (!entry) return c.redirect('/?error=invalid_state')
    pendingOAuth.delete(state)

    const tokenRes = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.callbackUrl,
        client_id: config.clientId,
        code_verifier: entry.codeVerifier,
      }),
    })
    if (!tokenRes.ok) {
      console.error('[oauth] token exchange failed:', await tokenRes.text())
      return c.redirect('/?error=token_exchange_failed')
    }
    const tokenData = (await tokenRes.json()) as OAuthTokens

    const userinfoRes = await fetch(config.userinfoUrl, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    if (!userinfoRes.ok) {
      console.error('[oauth] userinfo failed:', await userinfoRes.text())
      return c.redirect('/?error=userinfo_failed')
    }
    const userinfo = (await userinfoRes.json()) as OAuthUserInfo

    if (opts.onLogin) await opts.onLogin(userinfo, tokenData)

    const sessionToken = await createSessionToken({
      id: userinfo.sub,
      username: userinfo.username,
      display_name: userinfo.name,
    })

    setCookie(c, config.cookieName, sessionToken, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'Lax',
      maxAge: expiresIn,
      path: '/',
    })

    return c.redirect(entry.next ?? '/')
  })

  const authRoutes = new Hono()
  authRoutes.route('/', redirectRoutes)

  authRoutes.get('/me', (c) => {
    const user = c.get('user' as never) as SessionPayload | undefined
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    return c.json({ id: user.sub, username: user.username, name: user.name })
  })

  authRoutes.post('/logout', (c) => {
    deleteCookie(c, config.cookieName, { path: '/' })
    return c.json({ success: true })
  })

  function sessionMiddleware() {
    // biome-ignore lint/suspicious/noExplicitAny: see comment above
    return async (c: any, next: any) => {
      const cookie = getCookie(c, config.cookieName)
      if (cookie) {
        const payload = await verifySessionToken(cookie)
        if (payload) {
          c.set('user' as never, payload as never)
          return next()
        }
      }
      if (opts.verifyBearerToken) {
        const authHeader = c.req.header('Authorization')
        if (authHeader?.startsWith('Bearer ')) {
          const payload = await opts.verifyBearerToken(authHeader.slice(7))
          if (payload) {
            c.set('user' as never, payload as never)
            return next()
          }
        }
      }
      return c.json({ error: 'Unauthorized' }, 401)
    }
  }

  return {
    config,
    createSessionToken,
    verifySessionToken,
    authRoutes,
    redirectRoutes,
    sessionMiddleware,
  }
}
