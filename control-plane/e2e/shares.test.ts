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
describe.skip('shares', () => {
  let wsId: string
  let providerId: string
  let sessionId: string
  let shareId: string

  beforeAll(async () => {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
    if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY env var is required')

    const provider = await client.providers.create({
      name: 'e2e-shares-provider',
      provider_type: 'anthropic-oauth',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: OPENROUTER_API_KEY,
    })
    providerId = provider.id

    const ws = await client.workspaces.create({ name: 'e2e-shares-ws' })
    wsId = ws.id
    await client.workspaces.updateConfig(wsId, {
      model: 'stepfun/step-3.5-flash:free',
      provider_id: providerId,
    })
    await client.workspaces.start(wsId)
    await waitForStatus(wsId, 'running', 120_000)

    // Chat to create messages that can be shared
    const result = await client.sessions.chat(wsId, 'Reply with exactly: SHARE_TEST', {
      timeout: 60_000,
    })
    sessionId = result.sessionId!
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
