/**
 * Unit tests for `ensureWorkspaceRunning` — the auto-start gate that a chat turn
 * runs through before it is allowed to reach a workspace agent.
 *
 * All three collaborators are mocked (via `vi.hoisted` so the stub references
 * survive `vi.resetModules`): the reconcile scale (`startWorkspaceInstance`),
 * the config lookup (`getWorkspaceConfig`), and the address resolver
 * (`getWorkspaceAddress`). The `/health` poll hits a stubbed global `fetch`.
 *
 * The module keeps a process-level `inflight` map, so each test re-imports the
 * module fresh (`vi.resetModules` + dynamic import) to avoid cross-test leakage.
 * The poll loop `await fetch(...)` then `await setTimeout(1000)`, so tests use
 * fake timers and interleave `vi.advanceTimersByTimeAsync` with promise
 * settlement to drive it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from './db/types'

const { startWorkspaceInstance, getWorkspaceConfig, getWorkspaceAddress } = vi.hoisted(() => ({
  startWorkspaceInstance: vi.fn(),
  getWorkspaceConfig: vi.fn(),
  getWorkspaceAddress: vi.fn(),
}))

vi.mock('./workspace-reconcile', () => ({ startWorkspaceInstance }))
vi.mock('./db/workspaces', () => ({ getWorkspaceConfig }))
vi.mock('../lib/workspace-address', () => ({ getWorkspaceAddress }))

const fetchMock = vi.fn()

function ws(status: string): Workspace {
  return { id: 'ws1', status } as unknown as Workspace
}

// Re-import the module under test after `vi.resetModules` so its `inflight`
// map (and the fresh `WorkspaceStartError` class it exports) start clean.
async function load() {
  return import('./workspace-autostart')
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  startWorkspaceInstance.mockResolvedValue(undefined)
  getWorkspaceConfig.mockResolvedValue(undefined)
  getWorkspaceAddress.mockReturnValue('http://agent.test')
  fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ensureWorkspaceRunning', () => {
  it('resolves immediately for a running workspace without starting or polling', async () => {
    const { ensureWorkspaceRunning } = await load()
    await expect(ensureWorkspaceRunning(ws('running'))).resolves.toBeUndefined()
    expect(startWorkspaceInstance).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws for an error state and does not attempt a start', async () => {
    const { ensureWorkspaceRunning, WorkspaceStartError } = await load()
    await expect(ensureWorkspaceRunning(ws('error'))).rejects.toBeInstanceOf(WorkspaceStartError)
    expect(startWorkspaceInstance).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws when a stopped workspace has auto_start disabled, without starting', async () => {
    getWorkspaceConfig.mockResolvedValue({ auto_start: false })
    const { ensureWorkspaceRunning, WorkspaceStartError } = await load()
    const p = ensureWorkspaceRunning(ws('stopped'))
    await expect(p).rejects.toBeInstanceOf(WorkspaceStartError)
    await expect(p).rejects.toThrow(/auto-start is disabled/)
    expect(startWorkspaceInstance).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('starts a stopped workspace (auto_start undefined) then polls until healthy', async () => {
    const { ensureWorkspaceRunning } = await load()
    const p = ensureWorkspaceRunning(ws('stopped'))
    await expect(p).resolves.toBeUndefined()
    expect(startWorkspaceInstance).toHaveBeenCalledTimes(1)
    expect(startWorkspaceInstance).toHaveBeenCalledWith('ws1')
    expect(fetchMock).toHaveBeenCalledWith('http://agent.test/health', expect.anything())
  })

  it('does not start a "starting" workspace but polls /health until it passes', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true })
    const { ensureWorkspaceRunning } = await load()
    const p = ensureWorkspaceRunning(ws('starting'))
    await vi.advanceTimersByTimeAsync(0) // first (failing) probe
    await vi.advanceTimersByTimeAsync(1000) // wait then second (ok) probe
    await expect(p).resolves.toBeUndefined()
    expect(startWorkspaceInstance).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws after the ready-timeout budget when /health never passes', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    const { ensureWorkspaceRunning, WorkspaceStartError } = await load()
    const p = ensureWorkspaceRunning(ws('starting'))
    p.catch(() => {}) // pre-attach to keep the rejection from going unhandled
    await vi.advanceTimersByTimeAsync(91_000)
    await expect(p).rejects.toBeInstanceOf(WorkspaceStartError)
    await expect(p).rejects.toThrow(/did not become ready/)
  })

  it('collapses concurrent starts of the same workspace into a single start', async () => {
    const { ensureWorkspaceRunning } = await load()
    const p1 = ensureWorkspaceRunning(ws('stopped'))
    const p2 = ensureWorkspaceRunning(ws('stopped'))
    await expect(Promise.all([p1, p2])).resolves.toEqual([undefined, undefined])
    expect(startWorkspaceInstance).toHaveBeenCalledTimes(1)
  })

  it('tolerates a rejecting fetch (connection refused) and keeps polling', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValue({ ok: true })
    const { ensureWorkspaceRunning } = await load()
    const p = ensureWorkspaceRunning(ws('starting'))
    await vi.advanceTimersByTimeAsync(0) // first probe rejects, is swallowed
    await vi.advanceTimersByTimeAsync(1000) // second probe ok
    await expect(p).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
