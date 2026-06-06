import { describe, expect, test } from 'vitest'
import { client } from './setup'

describe('auth', () => {
  let promptId: string

  test('me() returns user info', async () => {
    const user = await client.auth.me()
    expect(user.username).toBeTruthy()
  })

  test('updateDefaultPrompt sets default prompt', async () => {
    // Create a prompt to use as default
    const prompt = await client.prompts.create({
      name: 'e2e-default-prompt',
      content: 'Default prompt for auth testing.',
    })
    promptId = prompt.id

    await client.auth.updateDefaultPrompt(promptId)

    const user = await client.auth.me()
    expect(user.default_prompt_id).toBe(promptId)
    expect(user.default_prompt_name).toBe('e2e-default-prompt')
  })

  test('updateDefaultPrompt with null clears default', async () => {
    await client.auth.updateDefaultPrompt(null)

    const user = await client.auth.me()
    expect(user.default_prompt_id).toBeNull()

    // Clean up the prompt
    if (promptId) {
      await client.prompts.delete(promptId)
    }
  })
})
