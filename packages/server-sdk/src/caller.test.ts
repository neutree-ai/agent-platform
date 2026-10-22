import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { CALLER_HEADER, CallerVerifier } from './caller.js'

function keyPair(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return { privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256' } }
}

// What the platform's MCP proxy sends.
function statement(key: ReturnType<typeof keyPair>, claims: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000)
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const head = `${enc({ alg: 'ES256', typ: 'JWT', kid: key.jwk.kid })}.${enc({ iat: now, exp: now + 300, ...claims })}`
  const sig = sign('sha256', Buffer.from(head), { key: key.privateKey, dsaEncoding: 'ieee-p1363' })
  return `${head}.${sig.toString('base64url')}`
}

const CLAIMS = { aud: 'the-app', sub: 'u1', ext: 'stu-7', workspace_id: 'w1', session_id: 's1' }

function verifierWith(keys: () => object[]) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ keys: keys() })))
  const verifier = new CallerVerifier({
    baseUrl: 'https://nap.test',
    clientId: 'the-app',
    fetch: fetchMock as unknown as typeof fetch,
  })
  return { verifier, fetchMock }
}

const req = (token?: string) =>
  new Request('https://app.test/mcp', { headers: token ? { [CALLER_HEADER]: token } : {} })

describe('CallerVerifier', () => {
  const key = keyPair('k1')

  it('returns the caller a valid statement names', async () => {
    const { verifier, fetchMock } = verifierWith(() => [key.jwk])

    expect(await verifier.verify(req(statement(key, CLAIMS)))).toEqual({
      userId: 'u1',
      externalId: 'stu-7',
      workspaceId: 'w1',
      sessionId: 's1',
    })
    expect(fetchMock).toHaveBeenCalledWith('https://nap.test/.well-known/jwks.json')
  })

  it('refuses a statement for another application', async () => {
    const { verifier } = verifierWith(() => [key.jwk])

    expect(await verifier.verify(req(statement(key, { ...CLAIMS, aud: 'other' })))).toBeNull()
  })

  it('refuses an expired statement', async () => {
    const { verifier } = verifierWith(() => [key.jwk])
    const old = Math.floor(Date.now() / 1000) - 3600

    expect(await verifier.verify(req(statement(key, { ...CLAIMS, exp: old })))).toBeNull()
  })

  it('refuses a statement whose claims were altered', async () => {
    const { verifier } = verifierWith(() => [key.jwk])
    const [h, , s] = statement(key, CLAIMS).split('.')
    const forged = Buffer.from(JSON.stringify({ ...CLAIMS, sub: 'admin', exp: 9e9 })).toString(
      'base64url',
    )

    expect(await verifier.verify(req(`${h}.${forged}.${s}`))).toBeNull()
  })

  it('refuses a statement signed with a key the platform does not publish', async () => {
    const { verifier } = verifierWith(() => [key.jwk])
    const stranger = keyPair('k1')

    expect(await verifier.verify(req(statement(stranger, CLAIMS)))).toBeNull()
  })

  it('returns null without a statement, and makes no call for it', async () => {
    const { verifier, fetchMock } = verifierWith(() => [key.jwk])

    expect(await verifier.verify(req())).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('picks up a rotated key, refetching at most once a minute', async () => {
    vi.useFakeTimers()
    const rotated = keyPair('k2')
    let published = [key.jwk]
    const { verifier, fetchMock } = verifierWith(() => published)
    await verifier.verify(req(statement(key, CLAIMS)))

    published = [rotated.jwk]
    // Too soon after the last fetch: an unknown key id is just refused.
    expect(await verifier.verify(req(statement(rotated, CLAIMS)))).toBeNull()
    vi.advanceTimersByTime(61_000)
    expect(await verifier.verify(req(statement(rotated, CLAIMS)))).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
