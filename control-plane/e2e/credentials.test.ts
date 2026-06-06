import { describe, expect, test } from 'vitest'
import { client } from './setup'

describe('credentials CRUD', () => {
  const credName = 'TEST_KEY'

  test('set credential', async () => {
    await client.credentials.set(credName, 'secret123', 'env')
    // set returns void; verify via list
    const creds = await client.credentials.list()
    const found = creds.find((c) => c.name === credName)
    expect(found).toBeDefined()
    expect(found!.inject).toBe('env')
  })

  test('list credentials does not expose value', async () => {
    const creds = await client.credentials.list()
    const found = creds.find((c) => c.name === credName)
    expect(found).toBeDefined()
    // ApiCredentialMeta does not include a value field
    expect((found as unknown as Record<string, unknown>).value).toBeUndefined()
  })

  test('set credential again (upsert) with new value', async () => {
    await client.credentials.set(credName, 'new-secret-456', 'env')

    // Should still exist with same name
    const creds = await client.credentials.list()
    const found = creds.find((c) => c.name === credName)
    expect(found).toBeDefined()
    expect(found!.inject).toBe('env')
  })

  test('delete credential', async () => {
    await client.credentials.delete(credName)

    const creds = await client.credentials.list()
    const found = creds.find((c) => c.name === credName)
    expect(found).toBeUndefined()
  })
})
