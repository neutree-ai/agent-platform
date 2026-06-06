import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { AppEnv } from '../lib/types'
import { generateToken, verifyToken } from '../services/auth'
import {
  createIdentity,
  deleteIdentity,
  getIdentityByExternal,
  listUserIdentities,
} from '../services/db/identities'
import { ensurePlatformToken } from '../services/db/shares'
import { getUser } from '../services/db/users'
import { getAuthorizeUrl, getUserByCode, getUserInfo, isWeComEnabled } from '../services/wecom'

const wecomAuth = new Hono<AppEnv>()

// Check if WeChat Work login is available
wecomAuth.get('/enabled', (c) => {
  return c.json({ enabled: isWeComEnabled() })
})

// Get authorization URL
// mode=login: redirect to login flow
// mode=bind: redirect to bind flow (requires auth)
wecomAuth.get('/authorize', (c) => {
  if (!isWeComEnabled()) {
    return c.json({ error: 'WeChat Work login is not configured' }, 400)
  }

  const mode = c.req.query('mode') || 'login'
  const referer = c.req.header('Referer') || c.req.header('Origin') || ''
  const origin = referer ? new URL(referer).origin : ''
  const redirectUri = `${origin}/api/auth/wecom/callback`
  const state = mode === 'bind' ? 'bind' : 'login'
  const url = getAuthorizeUrl(redirectUri, state)

  return c.json({ url })
})

// OAuth callback — handles both login and bind
wecomAuth.get('/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state') || 'login'

  if (!code) {
    return c.redirect('/login?error=missing_code')
  }

  try {
    // Exchange code for WeChat Work userid
    const { userid } = await getUserByCode(code)

    if (state === 'bind') {
      // Bind flow: manually verify JWT since callback is in the auth skip list
      const token = getCookie(c, 'token')
      const currentUser = token ? await verifyToken(token) : null
      if (!currentUser) {
        return c.redirect('/login?error=auth_required')
      }

      // Check if this WeChat Work account is already bound to another user
      const existing = await getIdentityByExternal('wecom', userid)
      if (existing && existing.user_id !== currentUser.sub) {
        return c.redirect('/?wecom_bind=already_bound')
      }

      // Create binding with display name from WeChat Work
      if (!existing) {
        const wecomUser = await getUserInfo(userid)
        await createIdentity(currentUser.sub, 'wecom', userid, wecomUser.name)
      }

      return c.redirect('/?wecom_bind=success')
    }

    // Login flow: find existing binding
    const identity = await getIdentityByExternal('wecom', userid)
    if (!identity) {
      return c.redirect('/login?error=not_bound')
    }

    const dbUser = await getUser(identity.user_id)

    if (!dbUser) {
      return c.redirect('/login?error=user_not_found')
    }

    if (dbUser.role === 'system') {
      return c.redirect('/login?error=system_account')
    }

    // Auto-provision platform service token
    ensurePlatformToken(dbUser.id).catch((err) =>
      console.error('[Auth] Failed to provision platform token:', err),
    )

    const token = await generateToken(dbUser)

    setCookie(c, 'token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      maxAge: 60 * 60 * 24,
      path: '/',
    })

    return c.redirect('/')
  } catch (err: any) {
    console.error('[WeChat Work] OAuth error:', err.message)
    return c.redirect('/login?error=oauth_failed')
  }
})

// List current user's identities
wecomAuth.get('/identities', async (c) => {
  const user = c.get('user')
  const identities = await listUserIdentities(user.sub)
  return c.json(
    identities.map((i) => ({
      provider: i.provider,
      display_name: i.display_name,
      external_id: i.external_id,
      created_at: i.created_at,
    })),
  )
})

// Unbind WeChat Work
wecomAuth.delete('/identity', async (c) => {
  const user = c.get('user')
  const deleted = await deleteIdentity(user.sub, 'wecom')
  if (!deleted) {
    return c.json({ error: 'No WeChat Work binding found' }, 404)
  }
  return c.json({ success: true })
})

export default wecomAuth
