import { describe, expect, test } from 'vitest'
import { client } from './setup'

describe('providers CRUD', () => {
  let providerId: string

  test('create provider', async () => {
    const provider = await client.providers.create({
      name: 'e2e-provider',
      provider_type: 'openai',
      base_url: 'https://api.openai.com/v1',
      api_key: 'sk-test-key-000',
    })
    expect(provider.id).toBeTruthy()
    expect(provider.name).toBe('e2e-provider')
    expect(provider.provider_type).toBe('openai')
    expect(provider.base_url).toBe('https://api.openai.com/v1')
    providerId = provider.id
  })

  test('list providers contains created provider', async () => {
    const providers = await client.providers.list()
    const found = providers.find((p) => p.id === providerId)
    expect(found).toBeDefined()
    expect(found!.name).toBe('e2e-provider')
  })

  test('update provider name', async () => {
    const updated = await client.providers.update(providerId, {
      name: 'e2e-provider-renamed',
    })
    expect(updated.name).toBe('e2e-provider-renamed')

    // Verify via list
    const providers = await client.providers.list()
    const found = providers.find((p) => p.id === providerId)
    expect(found!.name).toBe('e2e-provider-renamed')
  })

  test('delete provider', async () => {
    await client.providers.delete(providerId)

    const providers = await client.providers.list()
    const found = providers.find((p) => p.id === providerId)
    expect(found).toBeUndefined()
  })
})
