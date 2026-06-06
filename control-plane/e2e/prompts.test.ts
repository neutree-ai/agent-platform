import { describe, expect, test } from 'vitest'
import { client } from './setup'

describe('prompts CRUD', () => {
  let promptId: string

  test('create prompt', async () => {
    const prompt = await client.prompts.create({
      name: 'e2e-prompt',
      content: 'You are an assistant for automated testing.',
      is_public: false,
    })
    expect(prompt.id).toBeTruthy()
    expect(prompt.name).toBe('e2e-prompt')
    expect(prompt.content).toBe('You are an assistant for automated testing.')
    expect(prompt.is_public).toBe(false)
    promptId = prompt.id
  })

  test('list prompts contains created prompt', async () => {
    const prompts = await client.prompts.list()
    const found = prompts.find((p) => p.id === promptId)
    expect(found).toBeDefined()
    expect(found!.name).toBe('e2e-prompt')
  })

  test('get prompt by id', async () => {
    const prompt = await client.prompts.get(promptId)
    expect(prompt.id).toBe(promptId)
    expect(prompt.name).toBe('e2e-prompt')
    expect(prompt.content).toBe('You are an assistant for automated testing.')
  })

  test('update prompt content', async () => {
    const updated = await client.prompts.update(promptId, {
      content: 'Updated: You are a revised e2e test assistant.',
    })
    expect(updated.content).toBe('Updated: You are a revised e2e test assistant.')

    const fetched = await client.prompts.get(promptId)
    expect(fetched.content).toBe('Updated: You are a revised e2e test assistant.')
  })

  test('listPublic does NOT contain private prompt', async () => {
    const publicPrompts = await client.prompts.listPublic()
    const found = publicPrompts.find((p) => p.id === promptId)
    expect(found).toBeUndefined()
  })

  test('make prompt public and verify in listPublic', async () => {
    await client.prompts.update(promptId, { is_public: true })

    const publicPrompts = await client.prompts.listPublic()
    const found = publicPrompts.find((p) => p.id === promptId)
    expect(found).toBeDefined()
    expect(found!.is_public).toBe(true)
  })

  test('listVersions has versions from updates', async () => {
    const versions = await client.prompts.listVersions(promptId)
    // At least 2 versions: initial create + content update
    expect(versions.length).toBeGreaterThanOrEqual(2)
    // Versions should be ordered, latest first or by version number
    expect(versions[0].version).toBeGreaterThanOrEqual(1)
  })

  test('delete prompt', async () => {
    await client.prompts.delete(promptId)

    const prompts = await client.prompts.list()
    const found = prompts.find((p) => p.id === promptId)
    expect(found).toBeUndefined()
  })
})
