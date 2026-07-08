import type { UniversalItem } from '@/lib/api/sse'
import type { ApiMessage, AskUserRequest, ContextGauge, TurnStats } from '@/lib/api/types'
import { _resetPluginsForTests, registerPlugin } from '@/plugins/registry'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'
import type {
  AgentSessionApi,
  AgentSessionDeps,
  AgentSessionEffects,
  AgentSessionSSE,
  AgentSessionSlice,
  SSEHandlers,
} from './agent-session-store'
import { createAgentSessionStore } from './agent-session-store'

// ── Test helpers ──

/** Wraps a zustand StoreApi so tests can read state via `s.X` and call actions via `s.action()`. */
function unwrap(store: StoreApi<AgentSessionSlice>): AgentSessionSlice {
  return new Proxy({} as AgentSessionSlice, {
    get(_target, prop) {
      return store.getState()[prop as keyof AgentSessionSlice]
    },
  })
}

function makeApi(overrides?: Partial<AgentSessionApi>): AgentSessionApi {
  return {
    getWorkspaceMessages: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockResolvedValue({ chat_status: 'idle', pending_message: null }),
    setPendingMessage: vi.fn().mockResolvedValue(undefined),
    clearPendingMessage: vi.fn().mockResolvedValue(undefined),
    getPendingQuestion: vi.fn().mockResolvedValue(null),
    respondToQuestion: vi.fn().mockResolvedValue(undefined),
    interruptSession: vi.fn().mockResolvedValue({ success: true, interrupted: true }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function makeSSE(overrides?: Partial<AgentSessionSSE>): AgentSessionSSE {
  return {
    createAgentChat: vi.fn(),
    createCPReconnectStream: vi.fn(),
    ...overrides,
  }
}

function makeEffects(overrides?: Partial<AgentSessionEffects>): AgentSessionEffects {
  return {
    onSessionCreated: vi.fn(),
    onTurnComplete: vi.fn(),
    invalidateSessions: vi.fn(),
    invalidateWorkspaces: vi.fn(),
    ...overrides,
  }
}

function makeDeps(overrides?: {
  api?: Partial<AgentSessionApi>
  sse?: Partial<AgentSessionSSE>
  effects?: Partial<AgentSessionEffects>
}): AgentSessionDeps {
  return {
    api: makeApi(overrides?.api),
    sse: makeSSE(overrides?.sse),
    effects: makeEffects(overrides?.effects),
  }
}

function dbMessage(id: number, role: 'user' | 'assistant', text: string): ApiMessage {
  return {
    id: String(id),
    role,
    content: text,
    blocks: [{ type: 'text', text }],
    created_at: new Date().toISOString(),
  }
}

/** Create store + unwrapped accessor for concise tests. */
function make(wid: string, deps: AgentSessionDeps) {
  const raw = createAgentSessionStore(wid, deps)
  return { raw, s: unwrap(raw) }
}

// ── Tests ──

afterEach(() => {
  _resetPluginsForTests()
})

describe('createAgentSessionStore', () => {
  describe('initial state', () => {
    test('has correct initial values', () => {
      const { s } = make('ws-1', makeDeps())

      expect(s.workspaceId).toBe('ws-1')
      expect(s.activeSessionId).toBeUndefined()
      expect(s.messages).toEqual([])
      expect(s.isLoading).toBe(false)
      expect(s.isDeleting).toBe(false)
      expect(s.error).toBeNull()
      expect(s.pendingQuestion).toBeNull()
      expect(s.lastTurnStats).toBeNull()
      expect(s.isBusy).toBe(false)
      expect(s.isSwitching).toBe(false)
    })
  })

  describe('switchSession', () => {
    test('switching to a session loads history', async () => {
      const history = [dbMessage(1, 'user', 'hello'), dbMessage(2, 'assistant', 'hi there')]
      const deps = makeDeps({ api: { getWorkspaceMessages: vi.fn().mockResolvedValue(history) } })
      const { s } = make('ws-1', deps)

      await s.switchSession('session-1')

      expect(s.activeSessionId).toBe('session-1')
      expect(deps.api.getWorkspaceMessages).toHaveBeenCalledWith('ws-1', 'session-1')
      expect(s.messages).toHaveLength(2)
      expect(s.messages[0].role).toBe('user')
      expect(s.messages[0].content).toBe('hello')
      expect(s.messages[1].role).toBe('assistant')
      expect(s.messages[1].content).toBe('hi there')
    })

    test('switching to undefined clears messages (new session mode)', async () => {
      const deps = makeDeps({
        api: { getWorkspaceMessages: vi.fn().mockResolvedValue([dbMessage(1, 'user', 'hi')]) },
      })
      const { s } = make('ws-1', deps)

      await s.switchSession('session-1')
      expect(s.messages).toHaveLength(1)

      await s.switchSession(undefined)
      expect(s.activeSessionId).toBeUndefined()
      expect(s.messages).toEqual([])
    })

    test('reconnects SSE when session is active (chat_status=agent)', async () => {
      const deps = makeDeps({
        api: {
          getSession: vi.fn().mockResolvedValue({ chat_status: 'agent', pending_message: null }),
        },
      })
      const { s } = make('ws-1', deps)

      await s.switchSession('session-1')

      expect(deps.sse.createCPReconnectStream).toHaveBeenCalledWith(
        'ws-1',
        expect.any(Object),
        expect.any(AbortSignal),
        expect.any(Function),
      )
      expect(s.isLoading).toBe(true)
    })

    test('does not reconnect SSE when session is idle', async () => {
      const deps = makeDeps()
      const { s } = make('ws-1', deps)

      await s.switchSession('session-1')

      expect(deps.sse.createCPReconnectStream).not.toHaveBeenCalled()
      expect(s.isLoading).toBe(false)
    })

    test('reconnects from the authoritative getSession status, not a stale context snapshot', async () => {
      // Regression: switch-back / reload would skip reconnect when the
      // caller-supplied context snapshot was stale (taken before the turn
      // went live), leaving a running turn un-reattached and the composer
      // looking idle. The decision must follow the freshly fetched status.
      const deps = makeDeps({
        api: {
          getSession: vi.fn().mockResolvedValue({ chat_status: 'agent', pending_message: null }),
        },
      })
      const { s } = make('ws-1', deps)

      await s.switchSession('session-1', { sessionChatStatus: 'idle' })

      expect(deps.sse.createCPReconnectStream).toHaveBeenCalled()
      expect(s.isLoading).toBe(true)
    })

    test('aborts previous SSE stream when switching sessions', async () => {
      const abortSignals: AbortSignal[] = []
      const deps = makeDeps({
        api: {
          getSession: vi.fn().mockResolvedValue({ chat_status: 'agent', pending_message: null }),
        },
        sse: {
          createCPReconnectStream: vi.fn((_wid, _h, signal) => {
            abortSignals.push(signal)
          }),
        },
      })
      const { s } = make('ws-1', deps)

      await s.switchSession('session-1')
      expect(abortSignals[0].aborted).toBe(false)

      await s.switchSession('session-2')
      expect(abortSignals[0].aborted).toBe(true)
    })

    test('restores lastTurnStats from context', async () => {
      const stats: ContextGauge = { numTurns: 2, contextTokens: 100, contextWindow: 200 }
      const deps = makeDeps()
      const { s } = make('ws-1', deps)

      await s.switchSession('session-1', { lastTurnStats: stats })

      expect(s.lastTurnStats).toEqual(stats)
    })

    test('sets error on history load failure', async () => {
      const deps = makeDeps({
        api: { getWorkspaceMessages: vi.fn().mockRejectedValue(new Error('Network error')) },
      })
      const { s } = make('ws-1', deps)

      await s.switchSession('session-1')

      expect(s.error).toBe('Network error')
      expect(s.messages).toEqual([])
    })

    test('recovers pending question after loading history', async () => {
      const question: AskUserRequest = {
        requestId: 'req-1',
        questions: [{ id: 'q1', text: 'Continue?', type: 'text' }],
      } as AskUserRequest
      const deps = makeDeps({
        api: { getPendingQuestion: vi.fn().mockResolvedValue(question) },
      })
      const { s } = make('ws-1', deps)

      await s.switchSession('session-1')

      expect(deps.api.getPendingQuestion).toHaveBeenCalledWith('ws-1', 'session-1')
      expect(s.pendingQuestion).toEqual(question)
    })

    test('clears messages immediately and sets isSwitching during load', async () => {
      let resolveHistory: (value: ApiMessage[]) => void
      const deps = makeDeps({
        api: {
          getWorkspaceMessages: vi.fn().mockImplementation(
            () =>
              new Promise<ApiMessage[]>((r) => {
                resolveHistory = r
              }),
          ),
        },
      })
      const { s } = make('ws-1', deps)

      // Pre-populate with old messages
      s.sendMessage('old message')
      expect(s.messages.length).toBeGreaterThan(0)

      const p = s.switchSession('session-1')

      // Immediately: old messages cleared, isSwitching true
      expect(s.messages).toEqual([])
      expect(s.isSwitching).toBe(true)

      resolveHistory!([dbMessage(1, 'user', 'new')])
      await p

      expect(s.isSwitching).toBe(false)
      expect(s.messages).toHaveLength(1)
      expect(s.messages[0].content).toBe('new')
    })

    test('fetches history and pending question in parallel', async () => {
      const callOrder: string[] = []
      const deps = makeDeps({
        api: {
          getWorkspaceMessages: vi.fn().mockImplementation(() => {
            callOrder.push('history')
            return Promise.resolve([])
          }),
          getPendingQuestion: vi.fn().mockImplementation(() => {
            callOrder.push('question')
            return Promise.resolve(null)
          }),
        },
      })
      const { s } = make('ws-1', deps)

      await s.switchSession('session-1')

      // Both should have been called
      expect(deps.api.getWorkspaceMessages).toHaveBeenCalledWith('ws-1', 'session-1')
      expect(deps.api.getPendingQuestion).toHaveBeenCalledWith('ws-1', 'session-1')
    })

    test('still finalizes state when a stream abort bumps switchVersion mid-fetch', async () => {
      // Regression: switchSession used to guard its bail on `switchVersion`,
      // which is also bumped by any `abortActiveStream` call (stop/destroy/
      // StrictMode unmount cleanup). When a bare stream abort happened while
      // history was loading, the bail fired without clearing `isSwitching`
      // and the UI sat forever on the "empty + spinner" state.
      let resolveHistory!: (value: ApiMessage[]) => void
      const deps = makeDeps({
        api: {
          getWorkspaceMessages: vi.fn().mockImplementation(
            () =>
              new Promise<ApiMessage[]>((r) => {
                resolveHistory = r
              }),
          ),
        },
      })
      const { s } = make('ws-1', deps)

      const p = s.switchSession('session-1')
      expect(s.isSwitching).toBe(true)

      // Bare stream abort — does not change activeSessionId, but historically
      // bumped switchVersion and poisoned the in-flight switchSession.
      s.abortStream()

      resolveHistory([dbMessage(1, 'user', 'hello')])
      await p

      expect(s.activeSessionId).toBe('session-1')
      expect(s.isSwitching).toBe(false)
      expect(s.messages).toHaveLength(1)
    })

    test('switching to the currently-loaded session is a no-op', async () => {
      // Header Select clicking the active session, or any redundant switch:
      // we already hold consistent state, no need to abort the live stream
      // or refetch history.
      const deps = makeDeps({
        api: { getWorkspaceMessages: vi.fn().mockResolvedValue([dbMessage(1, 'user', 'hi')]) },
      })
      const { s } = make('ws-1', deps)

      await s.switchSession('session-1')
      expect(deps.api.getWorkspaceMessages).toHaveBeenCalledTimes(1)

      await s.switchSession('session-1')
      expect(deps.api.getWorkspaceMessages).toHaveBeenCalledTimes(1)
    })

    test('switching back to a session created in this turn reloads its history', async () => {
      // Bug regression: a session created via sendMessage marked itself as
      // "no need to load" (state was being built up live by SSE). After the
      // user switched away to another session and back, the marker stayed,
      // and the early-exit branch skipped abort/clear/fetch/reconnect — the
      // UI froze on the previous session's view.
      const aHistory = [dbMessage(1, 'user', 'A persisted'), dbMessage(2, 'assistant', 'A reply')]
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, handlers: SSEHandlers) => {
            handlers.onSessionStarted?.('session-A')
          }),
        },
        api: {
          getWorkspaceMessages: vi.fn().mockImplementation((_wid, sid) => {
            if (sid === 'session-A') return Promise.resolve(aHistory)
            return Promise.resolve([])
          }),
        },
      })
      const { s } = make('ws-1', deps)

      s.sendMessage('hello A')
      expect(s.activeSessionId).toBe('session-A')
      expect(deps.api.getWorkspaceMessages).not.toHaveBeenCalled()

      await s.switchSession('session-B')
      expect(s.activeSessionId).toBe('session-B')

      await s.switchSession('session-A')
      expect(s.activeSessionId).toBe('session-A')
      expect(deps.api.getWorkspaceMessages).toHaveBeenCalledWith('ws-1', 'session-A')
      expect(s.messages.map((m) => m.content)).toEqual(['A persisted', 'A reply'])
    })

    test('ignores stale history response if session changed during fetch', async () => {
      let resolveFirst: (value: ApiMessage[]) => void
      const firstCall = new Promise<ApiMessage[]>((r) => {
        resolveFirst = r
      })
      let callCount = 0
      const deps = makeDeps({
        api: {
          getWorkspaceMessages: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return firstCall
            return Promise.resolve([dbMessage(3, 'user', 'second')])
          }),
        },
      })
      const { s } = make('ws-1', deps)

      const p1 = s.switchSession('session-1')
      const p2 = s.switchSession('session-2')

      resolveFirst!([dbMessage(1, 'user', 'first')])
      await p1
      await p2

      expect(s.activeSessionId).toBe('session-2')
      expect(s.messages).toHaveLength(1)
      expect(s.messages[0].content).toBe('second')
    })
  })

  describe('cross-session event leakage', () => {
    test('stale session.ended from previous stream must not flip state on newly-switched session', async () => {
      // User starts a turn in session A, switches to session B while A's stream
      // is still in flight. Buffered events from A fire after the switch — they
      // must be discarded, not written to B.
      let capturedAHandlers: SSEHandlers | null = null
      const staleStats: TurnStats = {
        numTurns: 9,
        contextTokens: 999,
        contextWindow: 1000,
        costUsd: 0,
        durationMs: 0,
        inputTokens: 999,
        outputTokens: 999,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      }
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, handlers: SSEHandlers) => {
            if (!capturedAHandlers) capturedAHandlers = handlers
          }),
        },
        api: {
          getWorkspaceMessages: vi.fn().mockResolvedValue([dbMessage(1, 'user', 'B hi')]),
        },
      })
      const { s } = make('ws-1', deps)

      s.sendMessage('A go')
      expect(capturedAHandlers).not.toBeNull()
      await s.switchSession('session-B')
      s.sendMessage('B go')
      expect(s.isBusy).toBe(true)
      expect(s.isLoading).toBe(true)

      capturedAHandlers!.onSessionEnded?.('session-A', 'completed', staleStats)

      expect(s.isBusy).toBe(true)
      expect(s.isLoading).toBe(true)
      expect(s.lastTurnStats).not.toEqual(staleStats)
    })

    test('stale onError from previous stream must not set error on newly-switched session', async () => {
      let capturedAHandlers: SSEHandlers | null = null
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, handlers: SSEHandlers) => {
            if (!capturedAHandlers) capturedAHandlers = handlers
          }),
        },
      })
      const { s } = make('ws-1', deps)

      s.sendMessage('A go')
      await s.switchSession('session-B')
      s.sendMessage('B go')

      capturedAHandlers!.onError?.('stale error from A')

      expect(s.error).toBeNull()
      expect(s.isLoading).toBe(true)
    })

    test('stale pendingQuestion from previous stream must not surface on newly-switched session', async () => {
      let capturedAHandlers: SSEHandlers | null = null
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, handlers: SSEHandlers) => {
            if (!capturedAHandlers) capturedAHandlers = handlers
          }),
        },
      })
      const { s } = make('ws-1', deps)

      s.sendMessage('A go')
      await s.switchSession('session-B')
      s.sendMessage('B go')

      const staleQuestion: AskUserRequest = {
        requestId: 'stale',
        questions: [{ id: 'q', text: 'stale', type: 'text' }],
      } as AskUserRequest
      capturedAHandlers!.onQuestionRequested?.(staleQuestion)

      expect(s.pendingQuestion).toBeNull()
    })
  })

  describe('sendMessage', () => {
    test('adds user and placeholder assistant message', () => {
      const deps = makeDeps()
      const { s } = make('ws-1', deps)

      s.sendMessage('hello')

      expect(s.messages).toHaveLength(2)
      expect(s.messages[0].role).toBe('user')
      expect(s.messages[0].content).toBe('hello')
      expect(s.messages[1].role).toBe('assistant')
      expect(s.messages[1].content).toBe('')
      expect(s.messages[1].isStreaming).toBe(true)
      expect(s.isLoading).toBe(true)
    })

    test('calls SSE createAgentChat with correct args', async () => {
      const deps = makeDeps()
      const { s } = make('ws-1', deps)
      await s.switchSession('session-1')

      s.sendMessage('hello')

      expect(deps.sse.createAgentChat).toHaveBeenCalledWith(
        'ws-1',
        'hello',
        'session-1',
        expect.any(Object),
        expect.any(AbortSignal),
        undefined,
      )
    })

    test('passes images to SSE', () => {
      const deps = makeDeps()
      const { s } = make('ws-1', deps)
      const images = [{ data: 'base64data', media_type: 'image/png' }]

      s.sendMessage('look at this', images)

      expect(deps.sse.createAgentChat).toHaveBeenCalledWith(
        'ws-1',
        'look at this',
        undefined,
        expect.any(Object),
        expect.any(AbortSignal),
        images,
      )
    })

    test('does not send when already loading', () => {
      const deps = makeDeps()
      const { s } = make('ws-1', deps)

      s.sendMessage('first')
      s.sendMessage('second')

      expect(deps.sse.createAgentChat).toHaveBeenCalledTimes(1)
    })

    test('does not send empty message', () => {
      const deps = makeDeps()
      const { s } = make('ws-1', deps)

      s.sendMessage('  ')

      expect(deps.sse.createAgentChat).not.toHaveBeenCalled()
      expect(s.messages).toEqual([])
    })

    test('SSE session.started updates activeSessionId and skips history reload', async () => {
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, handlers: SSEHandlers) => {
            handlers.onSessionStarted?.('new-session-id')
          }),
        },
      })
      const { s } = make('ws-1', deps)

      s.sendMessage('hello')

      expect(s.activeSessionId).toBe('new-session-id')
      expect(deps.effects.onSessionCreated).toHaveBeenCalledWith('new-session-id')
      expect(deps.effects.invalidateSessions).toHaveBeenCalledWith('ws-1')

      await s.switchSession('new-session-id')
      expect(deps.api.getWorkspaceMessages).not.toHaveBeenCalled()
    })

    test('SSE text deltas accumulate in assistant message', () => {
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, handlers: SSEHandlers) => {
            handlers.onItemStarted?.({
              item_id: 'item-1',
              kind: 'message',
              role: 'assistant',
              status: 'in_progress',
              content: [],
            } as UniversalItem)
            handlers.onItemDelta?.('item-1', { type: 'text', text: 'Hello ' })
            handlers.onItemDelta?.('item-1', { type: 'text', text: 'world!' })
          }),
        },
      })
      const { s } = make('ws-1', deps)

      s.sendMessage('hi')

      const assistant = s.messages.find((m) => m.role === 'assistant')!
      expect(assistant.content).toBe('Hello world!')
      const textBlocks = assistant.blocks.filter((b) => b.type === 'text')
      expect(textBlocks).toHaveLength(1)
      expect(textBlocks[0].type === 'text' && textBlocks[0].text).toBe('Hello world!')
    })

    test('SSE tool_call events create tool blocks', () => {
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, handlers: SSEHandlers) => {
            handlers.onItemStarted?.({
              item_id: 'tc-1',
              kind: 'tool_call',
              role: null,
              status: 'in_progress',
              content: [{ type: 'tool_call', call_id: 'call-1', name: 'read_file', arguments: '' }],
            } as UniversalItem)
            handlers.onItemCompleted?.({
              item_id: 'tc-1',
              kind: 'tool_call',
              role: null,
              status: 'completed',
              content: [
                {
                  type: 'tool_call',
                  call_id: 'call-1',
                  name: 'read_file',
                  arguments: '{"path":"/a.ts"}',
                },
              ],
            } as UniversalItem)
          }),
        },
      })
      const { s } = make('ws-1', deps)

      s.sendMessage('read it')

      const assistant = s.messages.find((m) => m.role === 'assistant')!
      const toolBlock = assistant.blocks.find((b) => b.type === 'tool')
      expect(toolBlock).toBeDefined()
      expect(toolBlock!.type === 'tool' && toolBlock!.tool.name).toBe('read_file')
      expect(toolBlock!.type === 'tool' && toolBlock!.tool.input).toEqual({ path: '/a.ts' })
    })

    test('SSE tool_call populates input from start-event args (no completion event)', () => {
      // The Codex `execute` dispatcher's renderer is chosen by the (name, input)
      // pair — the approval card only resolves once input reveals the wrapped
      // {server, tool}. When a tool_call has no separate completion event (only
      // a tool_result follows), input must be populated on start or the block is
      // stranded on the generic renderer and the card never appears.
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, handlers: SSEHandlers) => {
            handlers.onItemStarted?.({
              item_id: 'tc-1',
              kind: 'tool_call',
              role: null,
              status: 'in_progress',
              content: [
                {
                  type: 'tool_call',
                  call_id: 'call-1',
                  name: 'execute',
                  arguments:
                    '{"server":"tos-platform","tool":"prompt_update_propose","arguments":{}}',
                },
              ],
            } as UniversalItem)
            handlers.onItemCompleted?.({
              item_id: 'tr-1',
              kind: 'tool_result',
              role: 'tool',
              status: 'completed',
              content: [{ type: 'tool_result', call_id: 'call-1', output: '{}' }],
            } as UniversalItem)
          }),
        },
      })
      const { s } = make('ws-1', deps)

      s.sendMessage('update the prompt')

      const assistant = s.messages.find((m) => m.role === 'assistant')!
      const toolBlock = assistant.blocks.find((b) => b.type === 'tool')!
      expect(toolBlock.type === 'tool' && toolBlock.tool.input).toEqual({
        server: 'tos-platform',
        tool: 'prompt_update_propose',
        arguments: {},
      })
    })

    test('SSE tool_result updates existing tool block', () => {
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, handlers: SSEHandlers) => {
            handlers.onItemStarted?.({
              item_id: 'tc-1',
              kind: 'tool_call',
              role: null,
              status: 'in_progress',
              content: [{ type: 'tool_call', call_id: 'call-1', name: 'read_file' }],
            } as UniversalItem)
            handlers.onItemCompleted?.({
              item_id: 'tr-1',
              kind: 'tool_result',
              role: 'tool',
              status: 'completed',
              content: [{ type: 'tool_result', call_id: 'call-1', output: 'file contents here' }],
            } as UniversalItem)
          }),
        },
      })
      const { s } = make('ws-1', deps)

      s.sendMessage('read it')

      const assistant = s.messages.find((m) => m.role === 'assistant')!
      const toolBlock = assistant.blocks.find((b) => b.type === 'tool')!
      expect(toolBlock.type === 'tool' && toolBlock.tool.result).toBe('file contents here')
    })

    test('SSE tool_result dispatches to matching plugin handlers', () => {
      _resetPluginsForTests()
      const onMatch = vi.fn()
      registerPlugin({
        id: 'test-plugin',
        toolResultHandlers: [
          {
            id: 'test.review-chunks',
            match: ({ toolName }) => toolName === 'batch_submit_review_chunks',
            onMatch,
          },
        ],
      })

      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, handlers: SSEHandlers) => {
            handlers.onItemStarted?.({
              item_id: 'tc-1',
              kind: 'tool_call',
              role: null,
              status: 'in_progress',
              content: [
                { type: 'tool_call', call_id: 'call-1', name: 'batch_submit_review_chunks' },
              ],
            } as UniversalItem)
            handlers.onItemCompleted?.({
              item_id: 'tr-1',
              kind: 'tool_result',
              role: 'tool',
              status: 'completed',
              content: [{ type: 'tool_result', call_id: 'call-1', output: 'ok' }],
            } as UniversalItem)
          }),
        },
      })
      const { s } = make('ws-1', deps)

      s.sendMessage('submit reviews')

      expect(onMatch).toHaveBeenCalledTimes(1)
      expect(onMatch.mock.calls[0][0]).toMatchObject({
        toolName: 'batch_submit_review_chunks',
        toolOutput: 'ok',
        callId: 'call-1',
        workspaceId: 'ws-1',
      })
    })

    test('SSE session.ended finalizes streaming and calls effects', () => {
      const stats: TurnStats = {
        numTurns: 2,
        contextTokens: 100,
        contextWindow: 200,
        costUsd: 0,
        durationMs: 0,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      }
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, handlers: SSEHandlers) => {
            handlers.onItemDelta?.('item-1', { type: 'text', text: 'done' })
            handlers.onSessionEnded?.('session-1', 'completed', stats)
          }),
        },
      })
      const { s } = make('ws-1', deps)

      s.sendMessage('go')

      expect(s.isLoading).toBe(false)
      expect(s.isBusy).toBe(false)
      expect(s.lastTurnStats).toEqual(stats)
      expect(s.pendingQuestion).toBeNull()
      expect(deps.effects.onTurnComplete).toHaveBeenCalled()
      expect(deps.effects.invalidateSessions).toHaveBeenCalledWith('ws-1')
      expect(deps.effects.invalidateWorkspaces).toHaveBeenCalled()

      const assistant = s.messages.find((m) => m.role === 'assistant')!
      expect(assistant.isStreaming).toBe(false)
    })

    test('SSE error sets error state', () => {
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, handlers: SSEHandlers) => {
            handlers.onError?.('Something went wrong')
          }),
        },
      })
      const { s } = make('ws-1', deps)

      s.sendMessage('go')

      expect(s.isLoading).toBe(false)
      expect(s.error).toBe('Something went wrong')
    })

    test('SSE question.requested sets pendingQuestion', () => {
      const question: AskUserRequest = {
        requestId: 'req-1',
        questions: [{ id: 'q1', text: 'Continue?', type: 'text' }],
      } as AskUserRequest
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, handlers: SSEHandlers) => {
            handlers.onQuestionRequested?.(question)
          }),
        },
      })
      const { s } = make('ws-1', deps)

      s.sendMessage('go')

      expect(s.pendingQuestion).toEqual(question)
    })
  })

  describe('respondToQuestion', () => {
    test('calls api and clears pendingQuestion', async () => {
      const question: AskUserRequest = {
        requestId: 'req-1',
        questions: [{ id: 'q1', text: 'Continue?', type: 'text' }],
      } as AskUserRequest
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, handlers: SSEHandlers) => {
            handlers.onQuestionRequested?.(question)
          }),
        },
      })
      const { s } = make('ws-1', deps)
      await s.switchSession('session-1')
      s.sendMessage('go')

      await s.respondToQuestion({ q1: 'yes' })

      expect(deps.api.respondToQuestion).toHaveBeenCalledWith('ws-1', 'session-1', 'req-1', {
        q1: 'yes',
      })
      expect(s.pendingQuestion).toBeNull()
    })
  })

  describe('stop', () => {
    test('aborts SSE and calls interrupt API', async () => {
      const abortSignals: AbortSignal[] = []
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, _h, signal) => {
            abortSignals.push(signal)
          }),
        },
      })
      const { s } = make('ws-1', deps)
      await s.switchSession('session-1')
      s.sendMessage('go')

      await s.stop()

      expect(abortSignals[0].aborted).toBe(true)
      expect(s.isLoading).toBe(false)
      expect(deps.api.interruptSession).toHaveBeenCalledWith('ws-1', 'session-1')
    })

    test('skips server interrupt during bootstrap window (no active session)', async () => {
      const deps = makeDeps()
      const { s } = make('ws-1', deps)

      await s.stop()

      expect(deps.api.interruptSession).not.toHaveBeenCalled()
    })

    test('keeps the stream alive when the interrupt missed (turn still starting)', async () => {
      const abortSignals: AbortSignal[] = []
      const deps = makeDeps({
        api: { interruptSession: vi.fn().mockResolvedValue({ success: true, interrupted: false }) },
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, _h, signal) => {
            abortSignals.push(signal)
          }),
        },
      })
      const { s } = make('ws-1', deps)
      await s.switchSession('session-1')
      s.sendMessage('go')

      await s.stop()

      expect(deps.api.interruptSession).toHaveBeenCalledWith('ws-1', 'session-1')
      expect(abortSignals[0].aborted).toBe(false)
      expect(s.error).toBeTruthy()
    })
  })

  describe('abortStream', () => {
    test('aborts SSE without calling interrupt API', () => {
      const abortSignals: AbortSignal[] = []
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, _h, signal) => {
            abortSignals.push(signal)
          }),
        },
      })
      const { s } = make('ws-1', deps)
      s.sendMessage('go')

      s.abortStream()

      expect(abortSignals[0].aborted).toBe(true)
      expect(s.isLoading).toBe(false)
      expect(deps.api.interruptSession).not.toHaveBeenCalled()
    })
  })

  describe('deleteSession', () => {
    test('aborts SSE, calls delete API, and clears messages', async () => {
      const deps = makeDeps()
      const { s } = make('ws-1', deps)
      await s.switchSession('session-1')
      s.sendMessage('go')

      await s.deleteSession()

      expect(deps.api.deleteSession).toHaveBeenCalledWith('ws-1', 'session-1')
      expect(s.messages).toEqual([])
      expect(s.error).toBeNull()
      expect(s.isDeleting).toBe(false)
    })

    test('sets isDeleting during the operation', async () => {
      let resolveDelete: () => void
      const deps = makeDeps({
        api: {
          deleteSession: vi.fn(
            () =>
              new Promise<void>((r) => {
                resolveDelete = r
              }),
          ),
        },
      })
      const { s } = make('ws-1', deps)
      await s.switchSession('session-1')

      const p = s.deleteSession()
      expect(s.isDeleting).toBe(true)
      expect(s.isBusy).toBe(true)

      resolveDelete!()
      await p
      expect(s.isDeleting).toBe(false)
    })
  })

  describe('reconnect', () => {
    test('opens CP reconnect stream', () => {
      const deps = makeDeps()
      const { s } = make('ws-1', deps)

      s.reconnect()

      expect(deps.sse.createCPReconnectStream).toHaveBeenCalledWith(
        'ws-1',
        expect.any(Object),
        expect.any(AbortSignal),
        expect.any(Function),
      )
      expect(s.isLoading).toBe(true)
    })

    test('reuses last assistant message for streaming', async () => {
      const history = [dbMessage(1, 'user', 'hi'), dbMessage(2, 'assistant', 'hello')]
      const deps = makeDeps({ api: { getWorkspaceMessages: vi.fn().mockResolvedValue(history) } })
      const { s } = make('ws-1', deps)
      await s.switchSession('session-1')

      s.reconnect()

      // Should reuse the existing assistant message, not add a new one
      expect(s.messages).toHaveLength(2)
      expect(s.messages[1].isStreaming).toBe(true)
    })

    test('creates placeholder when last message is from user', async () => {
      const history = [dbMessage(1, 'user', 'hi')]
      const deps = makeDeps({ api: { getWorkspaceMessages: vi.fn().mockResolvedValue(history) } })
      const { s } = make('ws-1', deps)
      await s.switchSession('session-1')

      s.reconnect()

      expect(s.messages).toHaveLength(2)
      expect(s.messages[1].role).toBe('assistant')
      expect(s.messages[1].isStreaming).toBe(true)
    })
  })

  describe('loadHistory / clearMessages', () => {
    test('loadHistory replaces messages', () => {
      const deps = makeDeps()
      const { s } = make('ws-1', deps)
      s.sendMessage('old')

      s.loadHistory([dbMessage(1, 'user', 'loaded')])

      expect(s.messages).toHaveLength(1)
      expect(s.messages[0].content).toBe('loaded')
      expect(s.error).toBeNull()
    })

    test('clearMessages empties state', () => {
      const deps = makeDeps()
      const { s } = make('ws-1', deps)
      s.sendMessage('something')

      s.clearMessages()

      expect(s.messages).toEqual([])
      expect(s.error).toBeNull()
      expect(s.lastTurnStats).toBeNull()
    })
  })

  describe('SSE item.completed for message', () => {
    test('replaces delta-accumulated text with authoritative completed text', () => {
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, handlers: SSEHandlers) => {
            handlers.onItemDelta?.('item-1', { type: 'text', text: 'partial...' })
            handlers.onItemCompleted?.({
              item_id: 'item-1',
              kind: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'text', text: 'full complete text' }],
            } as UniversalItem)
          }),
        },
      })
      const { s } = make('ws-1', deps)

      s.sendMessage('go')

      const assistant = s.messages.find((m) => m.role === 'assistant')!
      expect(assistant.content).toBe('full complete text')
      const textBlocks = assistant.blocks.filter((b) => b.type === 'text')
      expect(textBlocks).toHaveLength(1)
      expect(textBlocks[0].type === 'text' && textBlocks[0].text).toBe('full complete text')
    })

    test('preserves tool blocks when replacing text', () => {
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, handlers: SSEHandlers) => {
            handlers.onItemStarted?.({
              item_id: 'tc-1',
              kind: 'tool_call',
              role: null,
              status: 'in_progress',
              content: [{ type: 'tool_call', call_id: 'call-1', name: 'read_file' }],
            } as UniversalItem)
            handlers.onItemDelta?.('item-1', { type: 'text', text: 'partial' })
            handlers.onItemCompleted?.({
              item_id: 'item-1',
              kind: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'text', text: 'final text' }],
            } as UniversalItem)
          }),
        },
      })
      const { s } = make('ws-1', deps)

      s.sendMessage('go')

      const assistant = s.messages.find((m) => m.role === 'assistant')!
      expect(assistant.blocks.some((b) => b.type === 'tool')).toBe(true)
      expect(assistant.content).toBe('final text')
    })
  })

  describe('zustand subscribe / getState', () => {
    test('subscribe notifies on state change', () => {
      const deps = makeDeps()
      const { raw, s } = make('ws-1', deps)
      const listener = vi.fn()
      raw.subscribe(listener)

      s.sendMessage('hello')

      expect(listener).toHaveBeenCalled()
    })

    test('unsubscribe stops notifications', () => {
      const deps = makeDeps()
      const { raw, s } = make('ws-1', deps)
      const listener = vi.fn()
      const unsub = raw.subscribe(listener)

      unsub()
      s.sendMessage('hello')

      expect(listener).not.toHaveBeenCalled()
    })

    test('getState returns current state', () => {
      const deps = makeDeps()
      const { raw, s } = make('ws-1', deps)

      expect(raw.getState().workspaceId).toBe('ws-1')
      expect(raw.getState().messages).toEqual([])

      s.sendMessage('hello')
      expect(raw.getState().messages).toHaveLength(2)
    })
  })

  describe('destroy', () => {
    test('aborts active SSE and resets state', () => {
      const abortSignals: AbortSignal[] = []
      const deps = makeDeps({
        sse: {
          createAgentChat: vi.fn((_wid, _msg, _sid, _h, signal) => {
            abortSignals.push(signal)
          }),
        },
      })
      const { s } = make('ws-1', deps)
      s.sendMessage('go')

      s.destroy()

      expect(abortSignals[0].aborted).toBe(true)
      expect(s.messages).toEqual([])
      expect(s.isLoading).toBe(false)
      expect(s.activeSessionId).toBeUndefined()
    })
  })
})
