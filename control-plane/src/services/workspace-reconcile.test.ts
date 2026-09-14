import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./db/workspaces', () => ({
  getWorkspace: vi.fn(),
  getWorkspaceConfig: vi.fn(),
  updateWorkspace: vi.fn(),
}))
vi.mock('./db/workspace-tokens', () => ({ hasLiveWorkspaceToken: vi.fn() }))
vi.mock('./k8s', () => ({
  CURRENT_TEMPLATE_VERSION: 5,
  getInstanceSpecMarkers: vi.fn(),
  getAgentImage: vi.fn(() => 'agent:v5'),
  isMemoryFuseAvailable: vi.fn(() => true),
}))
vi.mock('./placement', () => ({
  bumpWorkspaceSpec: vi.fn(),
  ensureReplicaFloor: vi.fn(),
  setDesiredPhase: vi.fn(),
}))
vi.mock('./reflect', () => ({ reconcileReflectSchedule: vi.fn() }))

import { hasLiveWorkspaceToken } from './db/workspace-tokens'
import { getWorkspace, getWorkspaceConfig } from './db/workspaces'
import * as k8s from './k8s'
import { bumpWorkspaceSpec } from './placement'
import { reconcileReflectSchedule } from './reflect'
import { startWorkspaceInstance } from './workspace-reconcile'

const workspace = vi.mocked(getWorkspace)
const liveToken = vi.mocked(hasLiveWorkspaceToken)
const markers = vi.mocked(k8s.getInstanceSpecMarkers)
const bumpSpec = vi.mocked(bumpWorkspaceSpec)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getWorkspaceConfig).mockResolvedValue({ agent_type: 'claude-code' } as never)
  vi.mocked(reconcileReflectSchedule).mockResolvedValue(undefined as never)
  // An existing pod that matches the desired spec exactly: zero drift reasons,
  // so a rebuild here can only come from `force`.
  markers.mockResolvedValue({
    templateVersion: 5,
    agentImage: 'agent:v5',
    hasMemoryFuseSidecar: true,
  } as never)
})

describe('startWorkspaceInstance', () => {
  it('does not rebuild a running workspace whose token is still live', async () => {
    workspace.mockResolvedValue({ id: 'ws1', status: 'running' } as never)
    liveToken.mockResolvedValue(true)

    const result = await startWorkspaceInstance('ws1')

    expect(result.rebuilt).toBe(false)
    expect(bumpSpec).not.toHaveBeenCalled()
  })

  // The regression: a stop revokes every token immediately, but `workspaces.status`
  // is only flipped later by the reconcile watch. A start landing in that window
  // saw `running` and skipped the rebuild, leaving the live pod holding a token cp
  // rejects — indefinitely, since the env var is read once at container start.
  it('rebuilds a workspace still recorded as running once its tokens are revoked', async () => {
    workspace.mockResolvedValue({ id: 'ws1', status: 'running' } as never)
    liveToken.mockResolvedValue(false)

    const result = await startWorkspaceInstance('ws1')

    expect(result.rebuilt).toBe(true)
    expect(result.reason).toBe('forced (no live workspace token)')
    expect(bumpSpec).toHaveBeenCalledWith('ws1')
  })

  it('rebuilds when resuming from a non-running status without reading the token', async () => {
    workspace.mockResolvedValue({ id: 'ws1', status: 'stopped' } as never)

    const result = await startWorkspaceInstance('ws1')

    expect(result.rebuilt).toBe(true)
    expect(result.reason).toBe('forced (resuming from non-running)')
    // Resuming already forces the rebuild, so the extra query is not worth making.
    expect(liveToken).not.toHaveBeenCalled()
  })

  it('reports real drift rather than the force reason when both apply', async () => {
    workspace.mockResolvedValue({ id: 'ws1', status: 'running' } as never)
    liveToken.mockResolvedValue(false)
    markers.mockResolvedValue({
      templateVersion: 4,
      agentImage: 'agent:v5',
      hasMemoryFuseSidecar: true,
    } as never)

    const result = await startWorkspaceInstance('ws1')

    expect(result.reason).toBe('template_version 4 < 5')
  })

  it('leaves a workspace with no instance alone', async () => {
    workspace.mockResolvedValue({ id: 'ws1', status: 'running' } as never)
    liveToken.mockResolvedValue(false)
    markers.mockResolvedValue(null as never)

    const result = await startWorkspaceInstance('ws1')

    expect(result.rebuilt).toBe(false)
    expect(bumpSpec).not.toHaveBeenCalled()
  })
})
