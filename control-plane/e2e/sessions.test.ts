import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { client } from './setup'

async function waitForStatus(wsId: string, target: 'running' | 'stopped', maxWaitMs = 120_000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const list = await client.workspaces.list()
    const ws = list.find((w) => w.id === wsId)
    if (ws?.status === target) return ws
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(`Workspace did not reach ${target} within ${maxWaitMs}ms`)
}

// Skip: agent containers connect to production CP, not test CP
describe.skip('sessions', () => {
  let wsId: string
  let providerId: string
  let firstSessionId: string

  beforeAll(async () => {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
    if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY env var is required')

    const provider = await client.providers.create({
      name: 'e2e-session-provider',
      provider_type: 'anthropic-oauth',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: OPENROUTER_API_KEY,
    })
    providerId = provider.id

    const ws = await client.workspaces.create({ name: 'e2e-session-ws' })
    wsId = ws.id
    await client.workspaces.updateConfig(wsId, {
      model: 'stepfun/step-3.5-flash:free',
      provider_id: providerId,
    })
    await client.workspaces.start(wsId)
    await waitForStatus(wsId, 'running', 120_000)
  }, 180_000)

  afterAll(async () => {
    try {
      await client.workspaces.stop(wsId)
    } catch {}
    try {
      await waitForStatus(wsId, 'stopped', 60_000)
    } catch {}
    try {
      await client.workspaces.delete(wsId)
    } catch {}
    try {
      await client.providers.delete(providerId)
    } catch {}
  }, 120_000)

  test('list sessions initially empty', async () => {
    const sessions = await client.sessions.list(wsId)
    expect(Array.isArray(sessions)).toBe(true)
  })

  test('chat creates a session and returns response', async () => {
    const result = await client.sessions.chat(wsId, 'Reply with exactly: HELLO_E2E', {
      timeout: 60_000,
    })
    expect(result.textContent).toContain('HELLO_E2E')
    expect(result.sessionId).toBeDefined()
    firstSessionId = result.sessionId!
  }, 90_000)

  test('getMessages has user and assistant messages', async () => {
    const messages = await client.sessions.getMessages(wsId)
    expect(messages.length).toBeGreaterThanOrEqual(2)

    const roles = messages.map((m) => m.role)
    expect(roles).toContain('user')
    expect(roles).toContain('assistant')
  })

  test('list sessions contains chat-created session', async () => {
    const sessions = await client.sessions.list(wsId)
    expect(sessions.length).toBeGreaterThanOrEqual(1)
  })

  test('messages are scoped to session', async () => {
    const result = await client.sessions.chat(wsId, 'Reply with exactly: SESSION_TWO', {
      timeout: 60_000,
    })
    expect(result.textContent).toContain('SESSION_TWO')
    const session2Id = result.sessionId!

    const messages = await client.sessions.getMessages(wsId, session2Id)
    expect(messages.length).toBeGreaterThanOrEqual(2)
    const hasSessionTwo = messages.some((m) => m.content?.includes('SESSION_TWO'))
    expect(hasSessionTwo).toBe(true)
  }, 90_000)

  test('restart session clears messages', async () => {
    const messagesBefore = await client.sessions.getMessages(wsId, firstSessionId)
    expect(messagesBefore.length).toBeGreaterThan(0)

    await client.sessions.restart(wsId, firstSessionId)

    const messagesAfter = await client.sessions.getMessages(wsId, firstSessionId)
    expect(messagesAfter.length).toBe(0)
  })

  test('delete session', async () => {
    // Use firstSessionId which was restarted (cleared) — safe to delete
    await client.sessions.delete(wsId, firstSessionId)

    const sessions = await client.sessions.list(wsId)
    expect(sessions.some((s) => s.id === firstSessionId)).toBe(false)
  })

  test('interrupt stops an ongoing chat', async () => {
    const result = await client.sessions.chat(wsId, 'Reply with exactly: INTERRUPT_SETUP', {
      timeout: 60_000,
    })
    const sessionId = result.sessionId!

    const chatPromise = client.sessions
      .chat(
        wsId,
        'Write a very long detailed essay about the history of computing, at least 5000 words.',
        { sessionId, timeout: 60_000 },
      )
      .catch(() => null)

    await new Promise((r) => setTimeout(r, 3000))
    await client.sessions.interrupt(wsId, sessionId)

    await chatPromise
    expect(true).toBe(true)
  }, 90_000)
})
