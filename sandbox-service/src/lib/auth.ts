// Auth: verify NAP bearer tokens via control-plane, with service key bypass for internal calls.

import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { COOKIE_NAME, verifySessionToken } from './session'

const NAP_URL = process.env.NAP_URL || 'http://nap-cp:3000'
const SERVICE_KEY = process.env.SERVICE_KEY || ''

export interface AuthUser {
  sub: string
  username: string
  name: string
}

// Cache: token → { user, expiresAt }
const cache = new Map<string, { user: AuthUser; expiresAt: number }>()
const CACHE_TTL = 60_000

async function verifyBearerToken(token: string): Promise<AuthUser | null> {
  const cached = cache.get(token)
  if (cached && cached.expiresAt > Date.now()) return cached.user

  try {
    const res = await fetch(`${NAP_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null

    const data = (await res.json()) as {
      id?: string
      sub?: string
      username: string
      name?: string
    }
    const user: AuthUser = {
      sub: data.sub || data.id || '',
      username: data.username,
      name: data.name || data.username,
    }
    cache.set(token, { user, expiresAt: Date.now() + CACHE_TTL })
    return user
  } catch {
    return null
  }
}

/**
 * Resolve user from request. Checks (in order):
 * 1. X-Service-Key header (internal service bypass)
 * 2. Authorization: Bearer <token>
 * 3. ?token= query param (for preview proxy iframe embedding)
 */
export async function resolveUser(c: Context): Promise<AuthUser | null> {
  // Internal service key — returns a synthetic service user
  if (SERVICE_KEY) {
    const serviceKey = c.req.header('x-service-key')
    if (serviceKey === SERVICE_KEY) {
      return { sub: '_service', username: 'service', name: 'Service' }
    }
  }

  // Bearer token
  const authHeader = c.req.header('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return verifyBearerToken(authHeader.slice(7))
  }

  // Query param token (for preview proxy)
  const url = new URL(c.req.url)
  const queryToken = url.searchParams.get('token')
  if (queryToken) {
    return verifyBearerToken(queryToken)
  }

  // Session cookie (browser UI)
  const cookie = getCookie(c, COOKIE_NAME)
  if (cookie) {
    const payload = await verifySessionToken(cookie)
    if (payload) return { sub: payload.sub, username: payload.username, name: payload.name }
  }

  return null
}

// Cleanup stale cache entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of cache) {
    if (val.expiresAt < now) cache.delete(key)
  }
}, CACHE_TTL)
