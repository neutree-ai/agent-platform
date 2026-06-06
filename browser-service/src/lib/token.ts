// Verify NAP service tokens via control-plane API

const NAP_URL = process.env.NAP_INTERNAL_URL || process.env.NAP_OAUTH_URL || 'http://localhost:3000'

interface TokenUser {
  sub: string
  username: string
  name: string
}

// Cache: token → { user, expiresAt }
const cache = new Map<string, { user: TokenUser; expiresAt: number }>()
const CACHE_TTL = 60_000 // 60s

export async function verifyServiceToken(token: string): Promise<TokenUser | null> {
  // Check cache
  const cached = cache.get(token)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user
  }

  try {
    const res = await fetch(`${NAP_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      console.error(`[token] verifyServiceToken rejected: ${res.status} ${res.statusText}`)
      return null
    }

    interface MeResponse {
      id?: string
      sub?: string
      username: string
      name?: string
    }
    const data = (await res.json()) as MeResponse
    const user: TokenUser = {
      sub: data.sub || data.id || '',
      username: data.username,
      name: data.name || data.username,
    }
    cache.set(token, { user, expiresAt: Date.now() + CACHE_TTL })
    return user
  } catch (err) {
    console.error('[token] verifyServiceToken failed:', err)
    return null
  }
}

// Cleanup stale cache entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of cache) {
    if (val.expiresAt < now) cache.delete(key)
  }
}, CACHE_TTL)
