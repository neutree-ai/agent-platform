import { beforeEach, describe, expect, it, vi } from 'vitest'

// buildWorkspaceSpec is pure, but importing the module pulls in the pg pool —
// stub the DB modules so the test stays dependency-free.
vi.mock('./db/pool', () => ({ pool: { query: vi.fn() } }))
vi.mock('./db/workspaces', () => ({ getWorkspaceConfig: vi.fn() }))
vi.mock('./db/workspace-tokens', () => ({ revokeAllWorkspaceTokens: vi.fn() }))

import { pool } from './db/pool'
import { revokeAllWorkspaceTokens } from './db/workspace-tokens'
import { buildWorkspaceSpec, ensureReplicaFloor, setDesiredPhase } from './placement'

describe('buildWorkspaceSpec', () => {
  it('projects agent_type and compute_resources from the config row', () => {
    const config = {
      agent_type: 'codex',
      compute_resources: { cpu_request: '500m', memory_limit: '4Gi' },
    }
    expect(buildWorkspaceSpec(config, 3)).toEqual({
      agentType: 'codex',
      resources: { cpu_request: '500m', memory_limit: '4Gi' },
      version: 3,
      runtimeMode: 'static',
    })
  })

  it('null config → platform defaults (claude-code, empty resources, static)', () => {
    expect(buildWorkspaceSpec(null, 1)).toEqual({
      agentType: 'claude-code',
      resources: {},
      version: 1,
      runtimeMode: 'static',
    })
  })

  it('empty-string / null agent_type falls back to claude-code', () => {
    expect(buildWorkspaceSpec({ agent_type: '' }, 1).agentType).toBe('claude-code')
    expect(buildWorkspaceSpec({ agent_type: null }, 1).agentType).toBe('claude-code')
  })

  it('missing compute_resources → {} (never null/undefined on the wire)', () => {
    expect(buildWorkspaceSpec({ agent_type: 'codex' }, 2).resources).toEqual({})
  })

  // The shape is always stated, never inferred from a missing field: every spec
  // that reaches a provider names its runtimeMode, and a static one carries no
  // replica count to mis-read.
  it('static config (auto_scaling null/absent) projects the static shape, no replicas', () => {
    expect(buildWorkspaceSpec({ agent_type: 'codex', auto_scaling: null }, 1).runtimeMode).toBe(
      'static',
    )
    expect(buildWorkspaceSpec({ agent_type: 'codex' }, 1).runtimeMode).toBe('static')
    expect(buildWorkspaceSpec({ agent_type: 'codex' }, 1)).not.toHaveProperty('replicas')
  })

  it('auto-scaling config carries the shape + an initial replica count', () => {
    expect(buildWorkspaceSpec({ auto_scaling: { min_replicas: 2 } }, 5)).toEqual({
      agentType: 'claude-code',
      resources: {},
      version: 5,
      runtimeMode: 'auto-scaling',
      replicas: 2,
    })
  })

  it('auto-scaling with min_replicas 0 (scale-to-zero) still starts runnable at 1', () => {
    expect(buildWorkspaceSpec({ auto_scaling: { min_replicas: 0 } }, 1).replicas).toBe(1)
  })
})

describe('setDesiredPhase', () => {
  const revoke = vi.mocked(revokeAllWorkspaceTokens)

  beforeEach(() => {
    revoke.mockReset()
  })

  // Whatever took the workspace down — manual stop, idle GC, scale-to-zero —
  // its workloads are going away and should not keep a working credential.
  it.each(['stopped', 'deleted'] as const)('revokes the tokens on %s', async (phase) => {
    await setDesiredPhase('ws1', phase)

    expect(revoke).toHaveBeenCalledWith('ws1')
  })

  it('leaves the tokens alone when the workspace is meant to be up', async () => {
    await setDesiredPhase('ws1', 'running')

    expect(revoke).not.toHaveBeenCalled()
  })
})

describe('ensureReplicaFloor', () => {
  // The floor is expressed in the WHERE clause rather than read-then-write, so
  // what the test can assert is that the statement only ever raises a count
  // that is both present and below 1 — never a static spec, never a live count
  // the autoscaler is holding above the floor.
  it('only touches an auto-scaling spec sitting below one replica', async () => {
    vi.mocked(pool.query).mockClear()

    await ensureReplicaFloor('ws1')

    // Double cast: pg's overloads type a recorded call as a 3-tuple ending in
    // a callback, which does not overlap the pair this reads it as.
    const [sql, params] = vi.mocked(pool.query).mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain("spec ? 'replicas'")
    expect(sql).toContain("COALESCE((spec->>'replicas')::int, 0) < 1")
    expect(sql).toContain('spec_version = spec_version + 1')
    expect(params).toEqual(['ws1'])
  })
})
