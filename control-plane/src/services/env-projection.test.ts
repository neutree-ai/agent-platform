import { beforeEach, describe, expect, it, vi } from 'vitest'

// projectBuiltinAutoScalingStatus drives workspace.status for built-in
// auto-scaling (StatefulSet) workspaces from the runner's observed_phase, since
// the watch-k8s Deployment reconcile has no Deployment for them and skips them.

vi.mock('./db/environments', () => ({ listBuiltinAutoScalingObservations: vi.fn() }))
vi.mock('./db/workspaces', () => ({ getWorkspace: vi.fn(), deleteWorkspace: vi.fn() }))
vi.mock('../lib/workspace-status', () => ({ applyStatusChange: vi.fn() }))
vi.mock('../lib/remote-proxy', () => ({
  ensureRemoteProxy: vi.fn(),
  dropRemoteProxy: vi.fn(),
  syncReplicaProxies: vi.fn(),
}))

import { applyStatusChange } from '../lib/workspace-status'
import { listBuiltinAutoScalingObservations } from './db/environments'
import { getWorkspace } from './db/workspaces'
import { projectBuiltinAutoScalingStatus } from './env-projection'

const obs = vi.mocked(listBuiltinAutoScalingObservations)
const getWs = vi.mocked(getWorkspace)
const apply = vi.mocked(applyStatusChange)

beforeEach(() => vi.clearAllMocks())

describe('projectBuiltinAutoScalingStatus', () => {
  it('projects observed_phase → status when it differs from the current status', async () => {
    // The bug this fixes: watch-k8s marked the running StatefulSet ws 'stopped'.
    obs.mockResolvedValue([{ workspace_id: 'ws1', observed_phase: 'running' }])
    getWs.mockResolvedValue({ id: 'ws1', status: 'stopped' } as never)

    await projectBuiltinAutoScalingStatus()

    expect(apply).toHaveBeenCalledWith('ws1', 'running', 'stopped')
  })

  it('is a no-op when the status already matches (no needless resetAllSessionsIdle churn)', async () => {
    obs.mockResolvedValue([{ workspace_id: 'ws1', observed_phase: 'running' }])
    getWs.mockResolvedValue({ id: 'ws1', status: 'running' } as never)

    await projectBuiltinAutoScalingStatus()

    expect(apply).not.toHaveBeenCalled()
  })

  it('maps phases (stopped/pending/error/unknown) through the shared mapping', async () => {
    obs.mockResolvedValue([
      { workspace_id: 'a', observed_phase: 'stopped' },
      { workspace_id: 'b', observed_phase: 'pending' },
      { workspace_id: 'c', observed_phase: 'error' },
      { workspace_id: 'd', observed_phase: null },
    ])
    getWs.mockImplementation(async (id) => ({ id, status: 'running' }) as never)

    await projectBuiltinAutoScalingStatus()

    expect(apply).toHaveBeenCalledWith('a', 'stopped', 'running')
    expect(apply).toHaveBeenCalledWith('b', 'starting', 'running')
    expect(apply).toHaveBeenCalledWith('c', 'error', 'running')
    expect(apply).toHaveBeenCalledWith('d', 'unknown', 'running')
  })

  it('does nothing when no built-in workspace is auto-scaling (static-only cluster)', async () => {
    obs.mockResolvedValue([])
    await projectBuiltinAutoScalingStatus()
    expect(getWs).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })
})
