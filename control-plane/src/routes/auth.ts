import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2'
import { Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import type { ApiUser } from '../../../internal/types/api'
import type { AppEnv } from '../lib/types'
import { authenticateLdap, authenticateLocal, generateToken } from '../services/auth'
import { getPrompt } from '../services/db/prompts'
import { ensurePlatformToken } from '../services/db/shares'
import type { User } from '../services/db/types'
import {
  getUser,
  getUserByUsername,
  setUserAutoEvolution,
  setUserDefaultPrompt,
  setUserPassword,
  upsertUser,
} from '../services/db/users'

const auth = new Hono<AppEnv>()

// Get current user
auth.get('/me', async (c) => {
  const user = c.get('user')
  const dbUser = await getUser(user.sub)
  const defaultPrompt = dbUser?.default_prompt_id ? await getPrompt(dbUser.default_prompt_id) : null
  const response: ApiUser = {
    id: user.sub,
    username: user.username,
    role: dbUser?.role ?? user.role ?? 'user',
    auth_source: dbUser?.password_hash ? 'password' : 'ldap',
    default_prompt_id: defaultPrompt?.id ?? null,
    default_prompt_name: defaultPrompt?.name ?? null,
    auto_evolution: dbUser?.auto_evolution ?? false,
  }
  return c.json(response)
})

// Update user settings
auth.patch('/me', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{ auto_evolution?: boolean }>()
  if (body.auto_evolution !== undefined) {
    await setUserAutoEvolution(user.sub, body.auto_evolution)
  }
  return c.json({ success: true })
})

// Change own password (local-password users only)
auth.put('/me/password', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{ current_password?: string; new_password?: string }>()
  const currentPassword = body.current_password
  const newPassword = body.new_password

  if (!currentPassword || !newPassword) {
    return c.json({ error: 'current_password and new_password are required' }, 400)
  }
  if (newPassword.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters' }, 400)
  }
  if (newPassword === currentPassword) {
    return c.json({ error: 'New password must be different from current password' }, 400)
  }

  const dbUser = await getUser(user.sub)
  if (!dbUser) {
    return c.json({ error: 'User not found' }, 404)
  }
  if (!dbUser.password_hash) {
    return c.json({ error: 'Password change is not available for LDAP accounts' }, 400)
  }

  const ok = await argon2Verify(dbUser.password_hash, currentPassword)
  if (!ok) {
    return c.json({ error: 'Current password is incorrect' }, 401)
  }

  const newHash = await argon2Hash(newPassword)
  await setUserPassword(dbUser.id, newHash)
  return c.json({ success: true })
})

// Set default prompt for new workspaces
auth.put('/me/default-prompt', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{ prompt_id: string | null }>()
  await setUserDefaultPrompt(user.sub, body.prompt_id)
  return c.json({ success: true })
})

// Login
auth.post('/login', async (c) => {
  const body = await c.req.json<{ username: string; password: string }>()
  const { username, password } = body

  if (!username || !password) {
    return c.json({ error: 'Username and password are required' }, 400)
  }

  // Try local password first, then LDAP
  let dbUser: User | null = null

  if (await authenticateLocal(username, password)) {
    dbUser = await getUserByUsername(username)
  } else {
    const ldapUser = await authenticateLdap(username, password)
    if (!ldapUser) {
      return c.json({ error: 'Invalid credentials' }, 401)
    }
    dbUser = await upsertUser(ldapUser.username, ldapUser.name, ldapUser.email)
  }

  if (!dbUser) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  // Block system user from logging in
  if (dbUser.role === 'system') {
    return c.json({ error: 'This account cannot be used for login' }, 403)
  }

  // Auto-provision platform service token
  ensurePlatformToken(dbUser.id).catch((err) =>
    console.error('[Auth] Failed to provision platform token:', err),
  )

  // Update last_login_at for local auth
  upsertUser(dbUser.username, dbUser.display_name, dbUser.email ?? undefined).catch(() => {})

  const token = await generateToken(dbUser)

  setCookie(c, 'token', token, {
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24,
    path: '/',
  })

  const response: ApiUser = {
    id: dbUser.id,
    username: dbUser.username,
    role: dbUser.role,
    auth_source: dbUser.password_hash ? 'password' : 'ldap',
    default_prompt_id: null,
    default_prompt_name: null,
    auto_evolution: dbUser.auto_evolution,
  }
  return c.json(response)
})

// Logout
auth.post('/logout', (c) => {
  deleteCookie(c, 'token', { path: '/' })
  return c.json({ success: true })
})

export default auth
