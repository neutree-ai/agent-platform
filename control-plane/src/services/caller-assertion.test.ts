import { generateKeyPairSync } from 'node:crypto'
import { verify } from 'hono/jwt'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The key is read once per module, so each case loads a fresh copy after
// setting PLATFORM_SIGNING_KEY.
async function withKey(pem: string | undefined) {
  vi.stubEnv('PLATFORM_SIGNING_KEY', pem ?? '')
  vi.resetModules()
  return import('./caller-assertion')
}

function p256Pem(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('caller assertion', () => {
  it('signs a statement the published key verifies', async () => {
    const m = await withKey(p256Pem())

    const token = await m.signCallerAssertion({
      aud: 'the-app',
      sub: 'u1',
      ext: 'student-7',
      workspace_id: 'ws1',
      session_id: 's1',
    })

    // What an application does: verify against the key from the JWKS.
    const [publicJwk] = m.jwks().keys
    const claims = await verify(token as string, publicJwk, 'ES256')
    expect(claims).toMatchObject({
      aud: 'the-app',
      sub: 'u1',
      ext: 'student-7',
      workspace_id: 'ws1',
      session_id: 's1',
    })
    expect((claims.exp as number) - (claims.iat as number)).toBe(300)
    const header = JSON.parse(Buffer.from((token as string).split('.')[0], 'base64url').toString())
    expect(header.kid).toBe((publicJwk as { kid: string }).kid)
  })

  it('publishes only the public half of the key', async () => {
    const m = await withKey(p256Pem())

    expect(m.jwks().keys[0]).not.toHaveProperty('d')
  })

  it('fails verification once the payload is altered', async () => {
    const m = await withKey(p256Pem())
    const token = (await m.signCallerAssertion({
      aud: 'a',
      sub: 'u1',
      workspace_id: 'ws1',
    })) as string
    const [h, , s] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ aud: 'a', sub: 'admin', workspace_id: 'ws1' }),
    ).toString('base64url')

    await expect(verify(`${h}.${forged}.${s}`, m.jwks().keys[0], 'ES256')).rejects.toThrow()
  })

  it('accepts a key passed with escaped newlines, as env files often carry it', async () => {
    const m = await withKey(p256Pem().replace(/\n/g, '\\n'))

    expect(m.jwks().keys).toHaveLength(1)
  })

  it('signs nothing and publishes no key without PLATFORM_SIGNING_KEY', async () => {
    const m = await withKey(undefined)

    expect(await m.signCallerAssertion({ aud: 'a', sub: 'u1', workspace_id: 'ws1' })).toBeNull()
    expect(m.jwks()).toEqual({ keys: [] })
  })

  it('refuses a key that is not EC P-256', async () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const m = await withKey(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString())

    expect(() => m.loadSigningKey()).toThrow(/EC P-256/)
  })
})
