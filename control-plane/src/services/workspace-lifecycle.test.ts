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

import { getWorkspacePlacementEnv } from './db/environments'
import { deleteWorkspace, updateWorkspace } from './db/workspaces'
import * as k8s from './k8s'
import { setDesiredPhase } from './placement'
import { destroyWorkspace } from './workspace-lifecycle'

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
})
