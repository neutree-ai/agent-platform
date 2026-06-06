import { hash as argon2Hash } from '@node-rs/argon2'
import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import {
  createUser,
  deleteUser,
  getUser,
  getUserByUsername,
  listUsers,
  setUserPassword,
} from '../../services/db/users'

const users = new Hono<AppEnv>()

users.get('/', async (c) => {
  const list = await listUsers()
  return c.json(
    list.map((u) => ({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      email: u.email,
      role: u.role,
      auth_source: u.password_hash ? ('password' as const) : ('ldap' as const),
      created_at: u.created_at,
      last_login_at: u.last_login_at,
    })),
  )
})

users.post('/', async (c) => {
  const body = await c.req.json<{
    username: string
    display_name: string
    password: string
    email?: string
    role?: 'user' | 'admin'
  }>()

  if (!body.username || !body.display_name || !body.password) {
    return c.json({ error: 'username, display_name, and password are required' }, 400)
  }

  if (body.password.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters' }, 400)
  }

  const existing = await getUserByUsername(body.username)
  if (existing) {
    return c.json({ error: 'Username already exists' }, 409)
  }

  const passwordHash = await argon2Hash(body.password)
  const user = await createUser(
    body.username,
    body.display_name,
    passwordHash,
    body.email,
    body.role,
  )
  return c.json({ id: user.id, username: user.username }, 201)
})

users.put('/:id/password', async (c) => {
  const userId = c.req.param('id')
  const { password } = await c.req.json<{ password: string }>()

  if (!password || password.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters' }, 400)
  }

  const user = await getUser(userId)
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  if (!user.password_hash) {
    return c.json({ error: 'Cannot set password for LDAP users' }, 400)
  }

  const passwordHash = await argon2Hash(password)
  await setUserPassword(userId, passwordHash)
  return c.json({ success: true })
})

users.delete('/:id', async (c) => {
  const userId = c.req.param('id')
  const currentUser = c.get('user')

  if (userId === currentUser.sub) {
    return c.json({ error: 'Cannot delete yourself' }, 400)
  }

  const user = await getUser(userId)
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  if (!user.password_hash) {
    return c.json({ error: 'Cannot delete LDAP users' }, 400)
  }

  await deleteUser(userId)
  return c.json({ success: true })
})

export default users
