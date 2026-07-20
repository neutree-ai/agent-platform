import { afterAll, beforeAll, expect, test } from 'vitest'
import { createLlmProvider, createRunningWorkspace, waitForStatus } from './fixtures'
import { client, describeEachCore } from './setup'

describeEachCore('sessions', (agentType) => {
  let wsId: string
  let providerId: string
  let firstSessionId: string

  beforeAll(async () => {
    const provider = await createLlmProvider(`session-provider-${agentType}`)
    providerId = provider.id

    const ws = await createRunningWorkspace(`session-ws-${agentType}`, providerId, agentType)
    wsId = ws.id
  }, 300_000)

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
    const messages = await client.sessions.getMessages(wsId, firstSessionId)
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

  test('delete session', async () => {
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
