import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from './db/types'

// destroyWorkspace tears a built-in workspace down through k8s.destroy, which
// removes both workload shapes — a teardown that knew only one would leave the
// other's objects behind, and the workspace row goes next, so nothing would ever
// come back for them. Remote environments invert control (mark desired=deleted
// and let the runner reap), so cp must not delete their k8s directly.

vi.mock('../routes/workspaces/_shared', () => ({ interruptAllSessions: vi.fn() }))
vi.mock('./db/schedules', () => ({ listSchedulesByWorkspace: vi.fn().mockResolvedValue([]) }))
vi.mock('../lib/service-hooks', () => ({ fireDeleteHooks: vi.fn() }))
vi.mock('../lib/jobs', () => ({ cancelScheduleTimer: vi.fn() }))
vi.mock('./db/environments', () => ({ getWorkspacePlacementEnv: vi.fn() }))
vi.mock('./db/sessions', () => ({ resetAllSessionsIdle: vi.fn() }))
vi.mock('./db/workspaces', () => ({ deleteWorkspace: vi.fn(), updateWorkspace: vi.fn() }))
vi.mock('./placement', () => ({ setDesiredPhase: vi.fn() }))
vi.mock('./k8s', () => ({ destroy: vi.fn() }))
vi.mock('./usage/teardown', () => ({
  drainAfterStop: vi.fn(),
  drainBeforeDelete: vi.fn(),
}))

import { getWorkspacePlacementEnv } from './db/environments'
import { deleteWorkspace, updateWorkspace } from './db/workspaces'
import * as k8s from './k8s'
import { setDesiredPhase } from './placement'
import { drainAfterStop, drainBeforeDelete } from './usage/teardown'
import { destroyWorkspace, stopWorkspace } from './workspace-lifecycle'

const ws = { id: 'ws1' } as Workspace

beforeEach(() => vi.clearAllMocks())

describe('destroyWorkspace', () => {
  it('tears a built-in workspace down by shape (k8s.destroy)', async () => {
    vi.mocked(getWorkspacePlacementEnv).mockResolvedValue({ isBuiltin: true } as never)

    await destroyWorkspace(ws)

    expect(k8s.destroy).toHaveBeenCalledWith('ws1')
    expect(deleteWorkspace).toHaveBeenCalledWith('ws1')
    expect(setDesiredPhase).not.toHaveBeenCalled()
  })

  it('treats a null placement env as built-in (synchronous teardown)', async () => {
    vi.mocked(getWorkspacePlacementEnv).mockResolvedValue(null as never)

    await destroyWorkspace(ws)

    expect(k8s.destroy).toHaveBeenCalledWith('ws1')
    expect(deleteWorkspace).toHaveBeenCalledWith('ws1')
  })

  it('inverts control for a remote workspace: mark desired=deleted, no direct k8s teardown', async () => {
    vi.mocked(getWorkspacePlacementEnv).mockResolvedValue({ isBuiltin: false } as never)

    await destroyWorkspace(ws)

    expect(setDesiredPhase).toHaveBeenCalledWith('ws1', 'deleted')
    expect(updateWorkspace).toHaveBeenCalledWith('ws1', { status: 'deleting' })
    expect(k8s.destroy).not.toHaveBeenCalled()
    expect(deleteWorkspace).not.toHaveBeenCalled()
  })

  // Both teardown paths put the transcripts out of reach — the built-in one
  // destroys the volume, the remote one hands the workspace to a runner that
  // will. Collecting has to happen before either, not inside one of them.
  it.each([true, false])('collects usage before tearing down (builtin=%s)', async (isBuiltin) => {
    vi.mocked(getWorkspacePlacementEnv).mockResolvedValue({ isBuiltin } as never)
    const order: string[] = []
    vi.mocked(drainBeforeDelete).mockImplementation(async () => {
      order.push('drain')
    })
    vi.mocked(k8s.destroy).mockImplementation(async () => {
      order.push('teardown')
    })
    vi.mocked(setDesiredPhase).mockImplementation(async () => {
      order.push('teardown')
    })

    await destroyWorkspace(ws)
    expect(order).toEqual(['drain', 'teardown'])
  })

  it('passes force through, and lets a refusal stop the delete', async () => {
    vi.mocked(getWorkspacePlacementEnv).mockResolvedValue({ isBuiltin: true } as never)
    vi.mocked(drainBeforeDelete).mockRejectedValue(new Error('undrained'))

    await expect(destroyWorkspace(ws, true)).rejects.toThrow('undrained')
    expect(drainBeforeDelete).toHaveBeenCalledWith(ws, expect.any(Number), true)
    expect(k8s.destroy).not.toHaveBeenCalled()
    expect(deleteWorkspace).not.toHaveBeenCalled()
  })
})

describe('stopWorkspace', () => {
  it('collects usage on the way out, without waiting for it', async () => {
    await stopWorkspace(ws)

    expect(setDesiredPhase).toHaveBeenCalledWith('ws1', 'stopped')
    expect(drainAfterStop).toHaveBeenCalledWith('ws1', ws.user_id, expect.any(Number))
  })
})
