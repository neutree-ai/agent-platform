import { verify as argon2Verify } from '@node-rs/argon2'
import { sign, verify } from 'hono/jwt'
import { Client } from 'ldapts'
import { getUserByUsername } from './db/users'

// LDAP Configuration
const LDAP_CONFIG = {
  url: process.env.LDAP_URL || 'ldap://localhost:389',
  bindDN: process.env.LDAP_BIND_DN || 'cn=Manager,dc=example,dc=com',
  bindPassword: process.env.LDAP_BIND_PASSWORD || '',
  searchBase: process.env.LDAP_SEARCH_BASE || 'ou=Users,dc=example,dc=com',
  searchFilter: process.env.LDAP_SEARCH_FILTER || '(objectClass=inetOrgPerson)',
  attributes: {
    name: process.env.LDAP_ATTR_NAME || 'cn',
    username: process.env.LDAP_ATTR_USERNAME || 'sn',
    email: process.env.LDAP_ATTR_EMAIL || 'mail',
  },
}

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'nap-jwt-secret-change-me'
const JWT_EXPIRES_IN = 60 * 60 * 24 // 24 hours in seconds
const JWT_REFRESH_THRESHOLD = JWT_EXPIRES_IN / 2 // Refresh when less than 12 hours remain

interface LdapUser {
  dn: string
  name: string
  username: string
  email?: string
}

export interface JwtPayload {
  sub: string // db user id
  username: string // ldap username
  name: string
  email?: string
  role: 'user' | 'admin' | 'system'
  exp: number
  [key: string]: unknown // index signature for hono/jwt compatibility
}

/**
 * Authenticate user against LDAP
 */
export async function authenticateLdap(
  username: string,
  password: string,
): Promise<LdapUser | null> {
  const client = new Client({ url: LDAP_CONFIG.url })

  try {
    // First, bind as admin to search for the user
    await client.bind(LDAP_CONFIG.bindDN, LDAP_CONFIG.bindPassword)

    // Search for the user
    const { searchEntries } = await client.search(LDAP_CONFIG.searchBase, {
      scope: 'sub',
      filter: `(&${LDAP_CONFIG.searchFilter}(${LDAP_CONFIG.attributes.username}=${username}))`,
      attributes: [
        LDAP_CONFIG.attributes.name,
        LDAP_CONFIG.attributes.username,
        LDAP_CONFIG.attributes.email,
      ],
    })

    if (searchEntries.length === 0) {
      console.log(`LDAP: User not found: ${username}`)
      return null
    }

    const userEntry = searchEntries[0]
    const userDN = userEntry.dn

    // Unbind admin and try to bind as the user to verify password
    await client.unbind()

    const userClient = new Client({ url: LDAP_CONFIG.url })
    try {
      await userClient.bind(userDN, password)
      await userClient.unbind()
    } catch (_e) {
      console.log(`LDAP: Invalid password for user: ${username}`)
      return null
    }

    // Extract user info
    const getValue = (attr: string | string[] | Buffer | Buffer[] | undefined): string => {
      if (!attr) return ''
      if (Array.isArray(attr)) return String(attr[0])
      return String(attr)
    }

    return {
      dn: userDN,
      name: getValue(userEntry[LDAP_CONFIG.attributes.name]),
      username: getValue(userEntry[LDAP_CONFIG.attributes.username]),
      email: getValue(userEntry[LDAP_CONFIG.attributes.email]) || undefined,
    }
  } catch (e: any) {
    console.error('LDAP authentication error:', e.message)
    return null
  } finally {
    try {
      await client.unbind()
    } catch {}
  }
}

/**
 * Authenticate user with local password
 */
export async function authenticateLocal(username: string, password: string): Promise<boolean> {
  const user = await getUserByUsername(username)
  if (!user?.password_hash) return false
  return argon2Verify(user.password_hash, password)
}

/**
 * Generate JWT token for authenticated user
 */
export async function generateToken(dbUser: {
  id: string
  username: string
  display_name: string
  email: string | null
  role: 'user' | 'admin' | 'system'
}): Promise<string> {
  const payload: JwtPayload = {
    sub: dbUser.id,
    username: dbUser.username,
    name: dbUser.display_name,
    email: dbUser.email ?? undefined,
    role: dbUser.role,
    exp: Math.floor(Date.now() / 1000) + JWT_EXPIRES_IN,
  }

  return await sign(payload, JWT_SECRET)
}

/**
 * Verify and decode JWT token
 */
export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const payload = (await verify(token, JWT_SECRET, 'HS256')) as JwtPayload
    return payload
  } catch (e: any) {
    console.error('JWT verification error:', e.message || e)
    return null
  }
}

/**
 * Check if a token needs renewal (remaining time < threshold)
 */
export function shouldRenewToken(payload: JwtPayload): boolean {
  const now = Math.floor(Date.now() / 1000)
  return payload.exp - now < JWT_REFRESH_THRESHOLD
}

/**
 * Generate a renewed token from an existing payload
 */
export async function renewToken(payload: JwtPayload): Promise<string> {
  const renewed: JwtPayload = {
    sub: payload.sub,
    username: payload.username,
    name: payload.name,
    email: payload.email,
    role: payload.role,
    exp: Math.floor(Date.now() / 1000) + JWT_EXPIRES_IN,
  }
  return await sign(renewed, JWT_SECRET)
}
