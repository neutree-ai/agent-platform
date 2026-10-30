import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniversalEvent } from '../types/events.js'
import {
  type AcpSessionHandler,
  type AgentBridge,
  type PromptResponse,
  type SessionUpdate,
  hasChildProcess,
} from './acp-bridge.js'
import { type AcpAgentServerConfig, createAcpAgentApp } from './acp-server.js'

const SESSION = 'session-1'

/**
 * A bridge whose prompt stays in flight until the test settles it or the
 * bridge is destroyed — what an agent that has stopped answering looks like.
 */
function fakeBridge(opts: { cancel?: () => Promise<void> } = {}) {
  let settle: {
    resolve: (r: PromptResponse) => void
    reject: (e: Error) => void
  } | null = null
  let handler: AcpSessionHandler | null = null
  const bridge: AgentBridge = {
    start: async () => {},
    createSession: async () => SESSION,
    loadSession: async (id) => id,
    registerHandler: (_id, h) => {
      handler = h
    },
    unregisterHandler: () => {},
    waitForMcpReady: async () => {},
    prompt: () =>
      new Promise<PromptResponse>((resolve, reject) => {
        settle = { resolve, reject }
      }),
    cancel: vi.fn(opts.cancel ?? (async () => {})),
    isAlive: () => true,
    destroy: vi.fn(() => settle?.reject(new Error('AcpBridge destroyed'))),
  }
  return {
    bridge,
    promptStarted: () => settle !== null,
    finish: (stopReason: PromptResponse['stopReason']) => settle?.resolve({ stopReason }),
    toolCall: (toolCallId: string) =>
      handler?.onUpdate({
        sessionUpdate: 'tool_call',
        toolCallId,
        title: 'run',
      } as SessionUpdate),
  }
}

function createApp(bridges: AgentBridge[], extra: Partial<AcpAgentServerConfig> = {}) {
  const config: AcpAgentServerConfig = {
    agentType: 'test',
    capabilities: {} as AcpAgentServerConfig['capabilities'],
    keepFiles: new Set(),
    workspaceDir: tmpdir(),
    loadMcpServers: () => [],
    loadConfig: async () => true,
    loadSkills: async () => ({ ok: true, failed: [] }),
    loadCredentials: async () => true,
    ...extra,
  }
  const { app, setBridgeFactory } = createAcpAgentApp(config)
  setBridgeFactory(async () => {
    const next = bridges.shift()
    if (!next) throw new Error('no bridge left')
    return next
  })
  return app
}

function chat(app: ReturnType<typeof createApp>) {
  return app.request('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hi', session_id: SESSION }),
  })
}

function interrupt(app: ReturnType<typeof createApp>) {
  return app.request(`/sessions/${SESSION}/interrupt`, { method: 'POST' })
}

async function events(res: Response): Promise<UniversalEvent[]> {
  const text = await res.text()
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as UniversalEvent)
}

function ended(evts: UniversalEvent[]) {
  return evts.filter((e) => e.type === 'session.ended').map((e) => (e as { reason: string }).reason)
}

describe('interrupt', () => {
  beforeEach(() => {
    process.env.INTERRUPT_GRACE_MS = '50'
  })

  it('ends a turn the agent never ends, and reports it as interrupted', async () => {
    const stuck = fakeBridge()
    const app = createApp([stuck.bridge])

    const res = await chat(app)
    await vi.waitFor(() => expect(stuck.promptStarted()).toBe(true))
    expect((await interrupt(app)).status).toBe(200)

    const evts = await events(res)
    expect(ended(evts)).toEqual(['interrupted'])
    expect(evts.some((e) => e.type === 'error')).toBe(false)
    expect(stuck.bridge.destroy).toHaveBeenCalledTimes(1)
  })

  it('ends the turn at once when the agent cannot take the cancel', async () => {
    process.env.INTERRUPT_GRACE_MS = '60000'
    const stuck = fakeBridge({
      cancel: async () => {
        throw new Error('Connection is disposed')
      },
    })
    const app = createApp([stuck.bridge])

    const res = await chat(app)
    await vi.waitFor(() => expect(stuck.promptStarted()).toBe(true))
    await interrupt(app)

    expect(ended(await events(res))).toEqual(['interrupted'])
  })

  it('runs the next turn of the session on a fresh bridge', async () => {
    const stuck = fakeBridge()
    const fresh = fakeBridge()
    const app = createApp([stuck.bridge, fresh.bridge])

    const first = await chat(app)
    await vi.waitFor(() => expect(stuck.promptStarted()).toBe(true))
    await interrupt(app)
    await events(first)

    const second = await chat(app)
    await vi.waitFor(() => expect(fresh.promptStarted()).toBe(true))
    fresh.finish('end_turn')
    expect(ended(await events(second))).toEqual(['completed'])
  })

  it('leaves the bridge alone when the agent ends the turn in time', async () => {
    const healthy = fakeBridge()
    const app = createApp([healthy.bridge])

    const res = await chat(app)
    await vi.waitFor(() => expect(healthy.promptStarted()).toBe(true))
    await interrupt(app)
    healthy.finish('cancelled')

    expect(ended(await events(res))).toEqual(['interrupted'])
    await new Promise((r) => setTimeout(r, 120))
    expect(healthy.bridge.destroy).not.toHaveBeenCalled()
  })

  it('does not end a later turn of the same session', async () => {
    const bridge = fakeBridge()
    const app = createApp([bridge.bridge])

    const first = await chat(app)
    await vi.waitFor(() => expect(bridge.promptStarted()).toBe(true))
    await interrupt(app)
    bridge.finish('cancelled')
    await events(first)

    const second = await chat(app)
    await new Promise((r) => setTimeout(r, 120))
    expect(bridge.bridge.destroy).not.toHaveBeenCalled()
    bridge.finish('end_turn')
    expect(ended(await events(second))).toEqual(['completed'])
  })
})

describe('step budget', () => {
  beforeEach(() => {
    process.env.INTERRUPT_GRACE_MS = '50'
  })

  function errors(evts: UniversalEvent[]) {
    return evts.filter((e) => e.type === 'error').map((e) => (e as { message: string }).message)
  }

  it('interrupts the turn at the tool call past the budget and reports the budget', async () => {
    const agent = fakeBridge()
    const app = createApp([agent.bridge], { getMaxSteps: () => 2 })

    const res = await chat(app)
    await vi.waitFor(() => expect(agent.promptStarted()).toBe(true))
    agent.toolCall('a')
    agent.toolCall('b')
    expect(agent.bridge.cancel).not.toHaveBeenCalled()
    agent.toolCall('c')
    agent.toolCall('d')
    expect(agent.bridge.cancel).toHaveBeenCalledTimes(1)
    agent.finish('cancelled')

    const evts = await events(res)
    expect(ended(evts)).toEqual(['error'])
    expect(errors(evts)).toEqual([expect.stringContaining('step budget (2 tool calls)')])
  })

  it('reports the budget when the agent never answers the interrupt', async () => {
    const stuck = fakeBridge()
    const app = createApp([stuck.bridge], { getMaxSteps: () => 1 })

    const res = await chat(app)
    await vi.waitFor(() => expect(stuck.promptStarted()).toBe(true))
    stuck.toolCall('a')
    stuck.toolCall('b')

    const evts = await events(res)
    expect(ended(evts)).toEqual(['error'])
    expect(errors(evts)).toEqual([expect.stringContaining('step budget (1 tool calls)')])
    expect(stuck.bridge.destroy).toHaveBeenCalledTimes(1)
  })

  it('leaves a turn within its budget alone', async () => {
    const agent = fakeBridge()
    const app = createApp([agent.bridge], { getMaxSteps: () => 2 })

    const res = await chat(app)
    await vi.waitFor(() => expect(agent.promptStarted()).toBe(true))
    agent.toolCall('a')
    agent.toolCall('b')
    agent.finish('end_turn')

    expect(ended(await events(res))).toEqual(['completed'])
    expect(agent.bridge.cancel).not.toHaveBeenCalled()
  })
})

describe('hasChildProcess', () => {
  function procDir(stats: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'proc-'))
    for (const [pid, stat] of Object.entries(stats)) {
      mkdirSync(join(dir, pid))
      writeFileSync(join(dir, pid, 'stat'), stat)
    }
    mkdirSync(join(dir, 'self'))
    return dir
  }

  it('finds a live child', () => {
    const dir = procDir({
      '10': '10 (node) S 1 10 10',
      '11': '11 (codex) S 10 10 10',
    })
    expect(hasChildProcess(10, dir)).toBe(true)
    expect(hasChildProcess(11, dir)).toBe(false)
  })

  it('reads the parent pid past a command name with spaces and parens', () => {
    const dir = procDir({ '11': '11 (a) b (c) S 10 10 10' })
    expect(hasChildProcess(10, dir)).toBe(true)
  })

  it('does not count a zombie', () => {
    const dir = procDir({ '11': '11 (codex) Z 10 10 10' })
    expect(hasChildProcess(10, dir)).toBe(false)
  })

  it('reports a child when the process table cannot be read', () => {
    expect(hasChildProcess(10, join(tmpdir(), 'no-such-proc-dir'))).toBe(true)
  })
})
