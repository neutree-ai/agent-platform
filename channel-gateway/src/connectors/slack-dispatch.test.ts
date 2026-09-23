import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SocketHandler = (args: {
  event: Record<string, unknown>
  ack: () => Promise<void>
}) => Promise<void>

const socketMocks = vi.hoisted(() => ({
  handlers: new Map<string, SocketHandler>(),
  start: vi.fn(),
  disconnect: vi.fn(),
}))

const webMocks = vi.hoisted(() => ({
  authTest: vi.fn(),
  apiCall: vi.fn(),
  postMessage: vi.fn(),
  conversationsInfo: vi.fn(),
  conversationsReplies: vi.fn(),
}))

const dbMocks = vi.hoisted(() => ({
  getConnector: vi.fn(),
  getConnectorsByType: vi.fn(),
  getPlatformToken: vi.fn(),
  updateConnectorMetadata: vi.fn(),
  getRouteByExternalId: vi.fn(),
  claimEvent: vi.fn(),
  updateEvent: vi.fn(),
  getThreadSessionCursor: vi.fn(),
}))

const routeClientMocks = vi.hoisted(() => ({ resolveRouteClient: vi.fn() }))

vi.mock('@slack/socket-mode', () => ({
  SocketModeClient: class {
    on(event: string, handler: SocketHandler) {
      socketMocks.handlers.set(event, handler)
    }

    start = socketMocks.start
    disconnect = socketMocks.disconnect
  },
}))

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    auth = { test: webMocks.authTest }
    apiCall = webMocks.apiCall
    chat = { postMessage: webMocks.postMessage }
    conversations = {
      info: webMocks.conversationsInfo,
      replies: webMocks.conversationsReplies,
    }
  },
}))

vi.mock('../services/db', () => dbMocks)
vi.mock('../lib/route-client', () => routeClientMocks)

import { startOne, stopOne } from './slack'

describe('Slack job dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    socketMocks.handlers.clear()
    socketMocks.start.mockResolvedValue(undefined)
    socketMocks.disconnect.mockResolvedValue(undefined)
    webMocks.authTest.mockResolvedValue({ user_id: 'B1' })
    webMocks.apiCall.mockResolvedValue({ ok: true })
    webMocks.postMessage.mockResolvedValue({ ok: true })
    webMocks.conversationsInfo.mockResolvedValue({ channel: { name: 'general' } })
    dbMocks.getConnector.mockResolvedValue({
      id: 'connector-1',
      user_id: 'user-1',
      name: 'Slack test',
      type: 'slack',
      enabled: true,
      credentials: { app_token: 'xapp-test', bot_token: 'xoxb-test' },
    })
    dbMocks.getPlatformToken.mockResolvedValue('platform-token')
    dbMocks.getRouteByExternalId.mockResolvedValue({
      id: 'route-1',
      connector_id: 'connector-1',
      user_id: 'user-1',
      workspace_id: 'workspace-1',
      external_id: 'C1',
      config: {},
    })
    dbMocks.claimEvent.mockResolvedValue('event-1')
    dbMocks.updateEvent.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await stopOne('connector-1')
    vi.restoreAllMocks()
  })

  it('clears the thread status and replies when job creation fails', async () => {
    const error = new Error('control-plane unavailable')
    const create = vi.fn().mockRejectedValue(error)
    routeClientMocks.resolveRouteClient.mockResolvedValue({ jobs: { create } })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await startOne('connector-1')
    const handler = socketMocks.handlers.get('app_mention')
    expect(handler).toBeDefined()

    const ack = vi.fn().mockResolvedValue(undefined)
    await handler?.({
      event: { channel: 'C1', text: '<@B1> hello', user: 'U1', ts: '1.0' },
      ack,
    })

    expect(ack).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledOnce()
    expect(webMocks.apiCall).toHaveBeenNthCalledWith(1, 'assistant.threads.setStatus', {
      channel_id: 'C1',
      thread_ts: '1.0',
      status: 'is processing your request...',
    })
    expect(webMocks.apiCall).toHaveBeenNthCalledWith(2, 'assistant.threads.setStatus', {
      channel_id: 'C1',
      thread_ts: '1.0',
      status: '',
    })
    expect(webMocks.postMessage).toHaveBeenCalledWith({
      channel: 'C1',
      thread_ts: '1.0',
      text: 'Failed to start the job. Please retry.',
    })
    expect(dbMocks.updateEvent).toHaveBeenCalledWith('event-1', {
      status: 'error',
      error: 'control-plane unavailable',
    })
  })

  describe('thread auto-follow', () => {
    beforeEach(() => {
      dbMocks.getRouteByExternalId.mockResolvedValue({
        id: 'route-1',
        connector_id: 'connector-1',
        user_id: 'user-1',
        workspace_id: 'workspace-1',
        external_id: 'C1',
        config: { require_mention: false },
      })
      dbMocks.getThreadSessionCursor.mockResolvedValue({ session_id: 'session-1' })
      webMocks.conversationsReplies.mockResolvedValue({ messages: [] })
      vi.spyOn(console, 'log').mockImplementation(() => undefined)
    })

    async function sendMessage(event: Record<string, unknown>) {
      const create = vi.fn().mockResolvedValue({ id: 'job-1' })
      routeClientMocks.resolveRouteClient.mockResolvedValue({ jobs: { create } })
      await startOne('connector-1')
      const handler = socketMocks.handlers.get('message')
      expect(handler).toBeDefined()
      await handler?.({ event, ack: vi.fn().mockResolvedValue(undefined) })
      return create
    }

    it('follows thread replies that carry attachments', async () => {
      const create = await sendMessage({
        channel: 'C1',
        subtype: 'file_share',
        text: 'see screenshot',
        user: 'U1',
        ts: '2.0',
        thread_ts: '1.0',
        files: [],
      })
      expect(create).toHaveBeenCalledOnce()
    })

    it('ignores non-message subtypes such as edits', async () => {
      const create = await sendMessage({
        channel: 'C1',
        subtype: 'message_changed',
        user: 'U1',
        ts: '2.0',
        thread_ts: '1.0',
      })
      expect(create).not.toHaveBeenCalled()
    })
  })
})
