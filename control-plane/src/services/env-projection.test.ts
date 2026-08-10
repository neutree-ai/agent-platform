import { beforeEach, describe, expect, it, vi } from 'vitest'

// runEnvProjection is the single path that writes workspaces.status: it derives
// every workspace's status from what its runner reported into
// workspace_placements, for both environment kinds and both workload shapes.

vi.mock('./db/environments', () => ({
  listWorkspaceObservations: vi.fn(),
  listReapableWorkspaces: vi.fn(async () => []),
  markStaleEnvironmentsOffline: vi.fn(async () => []),
}))
vi.mock('./db/workspaces', () => ({ deleteWorkspace: vi.fn(), updateWorkspace: vi.fn() }))
vi.mock('../lib/workspace-status', () => ({ applyStatusChange: vi.fn() }))
vi.mock('../lib/remote-proxy', () => ({
  ensureRemoteProxy: vi.fn(),
  dropRemoteProxy: vi.fn(),
  syncReplicaProxies: vi.fn(),
}))

import { dropRemoteProxy, ensureRemoteProxy, syncReplicaProxies } from '../lib/remote-proxy'
import { applyStatusChange } from '../lib/workspace-status'
import { listWorkspaceObservations } from './db/environments'
import { updateWorkspace } from './db/workspaces'
import { runEnvProjection } from './env-projection'

const obs = vi.mocked(listWorkspaceObservations)
const updateWs = vi.mocked(updateWorkspace)
const apply = vi.mocked(applyStatusChange)

const THRESHOLD = 60

/** An observation row with the fields a test doesn't care about filled in. */
function observation(over: Partial<Parameters<typeof obs.mockResolvedValue>[0][number]>) {
  return {
    workspace_id: 'ws1',
    environment_id: 'builtin',
    is_builtin: true,
    observed_phase: 'running',
    observed_template_version: null,
    env_offline: false,
    ready_replica_ids: null,
    status: 'running',
    runtime_version: null,
    ...over,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('status projection', () => {
  it('projects observed_phase → status when it differs from the current status', async () => {
    obs.mockResolvedValue([observation({ observed_phase: 'running', status: 'stopped' })])

    await runEnvProjection(THRESHOLD)

    expect(apply).toHaveBeenCalledWith('ws1', 'running', 'stopped')
  })

  it('is a no-op when the status already matches (no needless resetAllSessionsIdle churn)', async () => {
    obs.mockResolvedValue([observation({ observed_phase: 'running' })])

    await runEnvProjection(THRESHOLD)

    expect(apply).not.toHaveBeenCalled()
  })

  it('maps the reported phases onto statuses', async () => {
    obs.mockResolvedValue([
      observation({ workspace_id: 'a', observed_phase: 'stopped' }),
      observation({ workspace_id: 'b', observed_phase: 'pending' }),
      observation({ workspace_id: 'c', observed_phase: 'starting' }),
      observation({ workspace_id: 'd', observed_phase: 'error' }),
    ])

    await runEnvProjection(THRESHOLD)

    expect(apply).toHaveBeenCalledWith('a', 'stopped', 'running')
    expect(apply).toHaveBeenCalledWith('b', 'starting', 'running')
    expect(apply).toHaveBeenCalledWith('c', 'starting', 'running')
    expect(apply).toHaveBeenCalledWith('d', 'error', 'running')
  })

  // Nothing provisioned means "not up" on the built-in environment, where cp and
  // the runner share a cluster; on a remote one the runner may simply have lost
  // sight of its own cluster, which is what 'unknown' says.
  it('reads an unprovisioned workspace as stopped on built-in, unknown on remote', async () => {
    obs.mockResolvedValue([
      observation({ workspace_id: 'a', is_builtin: true, observed_phase: 'unknown' }),
      observation({ workspace_id: 'b', is_builtin: true, observed_phase: null }),
      observation({
        workspace_id: 'c',
        is_builtin: false,
        environment_id: 'env1',
        observed_phase: 'unknown',
      }),
    ])

    await runEnvProjection(THRESHOLD)

    expect(apply).toHaveBeenCalledWith('a', 'stopped', 'running')
    expect(apply).toHaveBeenCalledWith('b', 'stopped', 'running')
    expect(apply).toHaveBeenCalledWith('c', 'unknown', 'running')
  })

  it('reads every workspace of an offline environment as unknown', async () => {
    obs.mockResolvedValue([
      observation({ is_builtin: false, environment_id: 'env1', env_offline: true }),
    ])

    await runEnvProjection(THRESHOLD)

    expect(apply).toHaveBeenCalledWith('ws1', 'unknown', 'running')
  })

  it('does nothing when nothing is placed', async () => {
    obs.mockResolvedValue([])

    await runEnvProjection(THRESHOLD)

    expect(apply).not.toHaveBeenCalled()
  })
})

describe('template-version cache', () => {
  it('caches a newly reported version onto the workspace row', async () => {
    obs.mockResolvedValue([observation({ observed_template_version: 8, runtime_version: 6 })])

    await runEnvProjection(THRESHOLD)

    expect(updateWs).toHaveBeenCalledWith('ws1', { runtime_version: 8 })
  })

  // A stopped workspace has no workload to read a version off, and the version it
  // last ran is still the truth — reporting none must not erase it.
  it('leaves the cached version alone when none was reported', async () => {
    obs.mockResolvedValue([
      observation({
        observed_phase: 'stopped',
        status: 'stopped',
        observed_template_version: null,
        runtime_version: 6,
      }),
    ])

    await runEnvProjection(THRESHOLD)

    expect(updateWs).not.toHaveBeenCalled()
  })

  it('does not rewrite an unchanged version', async () => {
    obs.mockResolvedValue([observation({ observed_template_version: 6, runtime_version: 6 })])

    await runEnvProjection(THRESHOLD)

    expect(updateWs).not.toHaveBeenCalled()
  })
})

describe('remote forward proxies', () => {
  it('keeps one proxy per ready replica when a replica set is reported', async () => {
    obs.mockResolvedValue([
      observation({ is_builtin: false, environment_id: 'env1', ready_replica_ids: [0, 2] }),
    ])

    await runEnvProjection(THRESHOLD)

    expect(syncReplicaProxies).toHaveBeenCalledWith('ws1', 'env1', [0, 2])
    expect(ensureRemoteProxy).not.toHaveBeenCalled()
  })

  it('keeps the single ordinal-less proxy when no replica set is reported', async () => {
    obs.mockResolvedValue([
      observation({ is_builtin: false, environment_id: 'env1', ready_replica_ids: null }),
    ])

    await runEnvProjection(THRESHOLD)

    expect(ensureRemoteProxy).toHaveBeenCalledWith('ws1', 'env1')
    expect(syncReplicaProxies).not.toHaveBeenCalled()
  })

  it('drops the proxy of a remote workspace that is not running', async () => {
    obs.mockResolvedValue([
      observation({ is_builtin: false, environment_id: 'env1', observed_phase: 'stopped' }),
    ])

    await runEnvProjection(THRESHOLD)

    expect(dropRemoteProxy).toHaveBeenCalledWith('ws1')
  })

  // Built-in workspaces are reached over cluster DNS; a proxy would be a tunnel
  // to cp's own cluster.
  it('never touches proxies for a built-in workspace', async () => {
    obs.mockResolvedValue([observation({ is_builtin: true })])

    await runEnvProjection(THRESHOLD)

    expect(ensureRemoteProxy).not.toHaveBeenCalled()
    expect(syncReplicaProxies).not.toHaveBeenCalled()
    expect(dropRemoteProxy).not.toHaveBeenCalled()
  })
})
