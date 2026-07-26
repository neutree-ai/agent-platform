import { afterAll, beforeAll, expect, test } from 'vitest'
import { createLlmProvider, createRunningWorkspace, waitForStatus } from './fixtures'
import { client, describeEachCore } from './setup'

describeEachCore('shares', (agentType) => {
  let wsId: string
  let providerId: string
  let sessionId: string
  let shareId: string

  beforeAll(async () => {
    const provider = await createLlmProvider(`shares-provider-${agentType}`)
    providerId = provider.id

    const ws = await createRunningWorkspace(`shares-ws-${agentType}`, providerId, agentType)
    wsId = ws.id

    // Chat to create messages that can be shared
    const result = await client.sessions.chat(wsId, 'Reply with exactly: SHARE_TEST', {
      timeout: 60_000,
    })
    sessionId = result.sessionId!
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

  test('create share', async () => {
    const share = await client.shares.create({
      workspace_id: wsId,
      session_id: sessionId,
    })
    expect(share.id).toBeDefined()
    shareId = share.id
  })

  test('list shares contains created share', async () => {
    const shares = await client.shares.list({ workspace_id: wsId, session_id: sessionId })
    expect(shares.some((s) => s.id === shareId)).toBe(true)
  })

  test('getPublic returns messages and config snapshot', async () => {
    const data = await client.shares.getPublic(shareId)
    expect(data).toBeDefined()
    expect(data.messages).toBeDefined()
    expect(Array.isArray(data.messages)).toBe(true)
    expect(data.workspaceConfig).toBeDefined()
  })

  test('update share title', async () => {
    await client.shares.update(shareId, { title: 'E2E Share Title' })
    // Verify by fetching public data
    const data = await client.shares.getPublic(shareId)
    expect(data.title).toBe('E2E Share Title')
  })

  test('delete share', async () => {
    await client.shares.delete(shareId)
    const shares = await client.shares.list({ workspace_id: wsId, session_id: sessionId })
    expect(shares.some((s) => s.id === shareId)).toBe(false)
  })
})
