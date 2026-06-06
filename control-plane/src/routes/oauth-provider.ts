import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import * as oauth from '../services/oauth-provider'

const oauthProvider = new Hono<AppEnv>()

// ── GET /api/oauth/authorize — return client info for frontend authorize page ──

oauthProvider.get('/authorize', async (c) => {
  const clientId = c.req.query('client_id')
  const redirectUri = c.req.query('redirect_uri')
  const responseType = c.req.query('response_type')
  const scope = c.req.query('scope') || 'profile'

  if (responseType !== 'code') {
    return c.json({ error: 'unsupported_response_type' }, 400)
  }
  if (!clientId || !redirectUri) {
    return c.json(
      { error: 'invalid_request', error_description: 'client_id and redirect_uri are required' },
      400,
    )
  }

  const client = await oauth.getClient(clientId)
  if (!client) {
    return c.json({ error: 'invalid_client' }, 400)
  }
  if (!oauth.validateRedirectUri(client, redirectUri)) {
    return c.json({ error: 'invalid_redirect_uri' }, 400)
  }

  return c.json({ client_name: client.name, scope })
})

// ── POST /api/oauth/authorize — user approves, generate code and redirect ──

oauthProvider.post('/authorize', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{
    client_id: string
    redirect_uri: string
    response_type: string
    state?: string
    code_challenge?: string
    code_challenge_method?: string
    scope?: string
  }>()

  const { client_id, redirect_uri, response_type, state, code_challenge, code_challenge_method } =
    body
  const scope = body.scope || 'profile'

  if (response_type !== 'code') {
    return c.json({ error: 'unsupported_response_type' }, 400)
  }
  if (!client_id || !redirect_uri) {
    return c.json({ error: 'invalid_request' }, 400)
  }
  if (code_challenge && code_challenge_method !== 'S256') {
    return c.json(
      {
        error: 'invalid_request',
        error_description: 'only S256 code_challenge_method is supported',
      },
      400,
    )
  }

  const client = await oauth.getClient(client_id)
  if (!client) {
    return c.json({ error: 'invalid_client' }, 400)
  }
  if (!oauth.validateRedirectUri(client, redirect_uri)) {
    return c.json({ error: 'invalid_redirect_uri' }, 400)
  }

  const code = await oauth.createAuthorizationCode({
    clientId: client_id,
    userId: user.sub,
    redirectUri: redirect_uri,
    codeChallenge: code_challenge || null,
    scope,
  })

  const url = new URL(redirect_uri)
  url.searchParams.set('code', code)
  if (state) url.searchParams.set('state', state)

  return c.json({ redirect_uri: url.toString() })
})

// ── POST /api/oauth/token — exchange code or refresh token for access token ──

oauthProvider.post('/token', async (c) => {
  // Accept both form-urlencoded and JSON
  const contentType = c.req.header('content-type') || ''
  let params: Record<string, string>
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await c.req.parseBody()
    params = Object.fromEntries(Object.entries(formData).map(([k, v]) => [k, String(v)]))
  } else {
    params = await c.req.json()
  }

  const { grant_type, client_id } = params

  if (!client_id) {
    return c.json({ error: 'invalid_request', error_description: 'client_id is required' }, 400)
  }

  // ── authorization_code grant ──
  if (grant_type === 'authorization_code') {
    const { code, redirect_uri, code_verifier } = params

    if (!code || !redirect_uri) {
      return c.json({ error: 'invalid_request' }, 400)
    }

    const authCode = await oauth.consumeAuthorizationCode(code)
    if (!authCode) {
      return c.json(
        { error: 'invalid_grant', error_description: 'code is invalid or expired' },
        400,
      )
    }
    if (authCode.client_id !== client_id) {
      return c.json({ error: 'invalid_grant', error_description: 'client_id mismatch' }, 400)
    }
    if (authCode.redirect_uri !== redirect_uri) {
      return c.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400)
    }

    // PKCE verification
    if (authCode.code_challenge) {
      if (!code_verifier) {
        return c.json(
          { error: 'invalid_request', error_description: 'code_verifier is required' },
          400,
        )
      }
      const valid = await oauth.verifyCodeChallenge(code_verifier, authCode.code_challenge)
      if (!valid) {
        return c.json(
          { error: 'invalid_grant', error_description: 'PKCE verification failed' },
          400,
        )
      }
    }

    const user = await oauth.getUserById(authCode.user_id)
    if (!user) {
      return c.json({ error: 'server_error' }, 500)
    }

    const { access_token, expires_in } = await oauth.issueAccessToken(user)
    const refresh_token = await oauth.issueRefreshToken(user.id, client_id)

    return c.json({
      access_token,
      refresh_token,
      token_type: 'Bearer',
      expires_in,
    })
  }

  // ── refresh_token grant ──
  if (grant_type === 'refresh_token') {
    const { refresh_token } = params

    if (!refresh_token) {
      return c.json(
        { error: 'invalid_request', error_description: 'refresh_token is required' },
        400,
      )
    }

    const record = await oauth.consumeRefreshToken(refresh_token)
    if (!record) {
      return c.json(
        { error: 'invalid_grant', error_description: 'refresh_token is invalid or expired' },
        400,
      )
    }
    if (record.client_id !== client_id) {
      return c.json({ error: 'invalid_grant', error_description: 'client_id mismatch' }, 400)
    }

    const user = await oauth.getUserById(record.user_id)
    if (!user) {
      return c.json({ error: 'server_error' }, 500)
    }

    const { access_token, expires_in } = await oauth.issueAccessToken(user)
    const new_refresh_token = await oauth.issueRefreshToken(user.id, client_id)

    return c.json({
      access_token,
      refresh_token: new_refresh_token,
      token_type: 'Bearer',
      expires_in,
    })
  }

  // ── token_exchange grant (RFC 8693) ──
  //
  // Used by trusted backend services (e.g. citewright) to obtain a
  // cp-scoped access token on behalf of an end user. The caller proves
  // possession of a token issued by another AS (typically itself) via
  // `subject_token`; cp validates it by calling the resource server's
  // /introspect endpoint and then issues its own JWT for the resolved user.
  if (grant_type === 'urn:ietf:params:oauth:grant-type:token-exchange') {
    const subjectToken = params.subject_token
    const subjectType = params.subject_token_type
    const resource = params.resource
    const clientSecret = params.client_secret

    if (!subjectToken) {
      return c.json(
        { error: 'invalid_request', error_description: 'subject_token is required' },
        400,
      )
    }
    if (subjectType && subjectType !== 'urn:ietf:params:oauth:token-type:access_token') {
      return c.json(
        { error: 'invalid_request', error_description: 'unsupported subject_token_type' },
        400,
      )
    }
    if (!resource) {
      return c.json(
        { error: 'invalid_request', error_description: 'resource is required (RS origin)' },
        400,
      )
    }

    const client = await oauth.getClient(client_id)
    if (!client) return c.json({ error: 'invalid_client' }, 400)
    if (!clientSecret || !oauth.verifyClientSecret(client, clientSecret)) {
      return c.json({ error: 'invalid_client' }, 401)
    }

    let resourceUrl: URL
    try {
      resourceUrl = new URL(resource)
    } catch {
      return c.json({ error: 'invalid_request', error_description: 'resource must be a URL' }, 400)
    }

    const verified = await oauth.verifySubjectToken(subjectToken, resourceUrl)
    if (!verified) {
      return c.json({ error: 'invalid_grant', error_description: 'subject_token not active' }, 400)
    }

    const user = await oauth.getUserById(verified.userId)
    if (!user) return c.json({ error: 'invalid_grant', error_description: 'user not found' }, 400)

    const { access_token, expires_in } = await oauth.issueAccessToken(user)
    return c.json({
      access_token,
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      token_type: 'Bearer',
      expires_in,
    })
  }

  return c.json({ error: 'unsupported_grant_type' }, 400)
})

// ── GET /api/oauth/userinfo — return user profile ──

oauthProvider.get('/userinfo', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'invalid_token' }, 401)
  }

  const token = authHeader.slice(7)
  const payload = await oauth.verifyToken(token)
  if (!payload) {
    return c.json({ error: 'invalid_token' }, 401)
  }

  return c.json({
    sub: payload.sub,
    username: payload.username,
    name: payload.name,
    email: payload.email,
  })
})

export default oauthProvider
