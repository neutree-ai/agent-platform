import { describe, expect, test } from 'vitest'
import { client } from './setup'

describe('service tokens CRUD', () => {
  let tokenId: string

  test('create token returns plaintext', async () => {
    const token = await client.serviceTokens.create({ name: 'e2e-test-token' })
    expect(token.id).toBeTruthy()
    expect(token.name).toBe('e2e-test-token')
    expect(token.token).toBeTruthy() // plaintext token returned on creation
    expect(token.created_at).toBeTruthy()
    tokenId = token.id
  })

  test('list tokens contains created token without plaintext', async () => {
    const tokens = await client.serviceTokens.list()
    const found = tokens.find((t) => t.id === tokenId)
    expect(found).toBeDefined()
    expect(found!.name).toBe('e2e-test-token')
    // Plaintext should not be present in list response
    expect(found!.token).toBeFalsy()
  })

  test('delete token', async () => {
    await client.serviceTokens.delete(tokenId)

    const tokens = await client.serviceTokens.list()
    const found = tokens.find((t) => t.id === tokenId)
    expect(found).toBeUndefined()
  })
})
