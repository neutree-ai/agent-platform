import { describe, expect, it, vi } from 'vitest'

// buildWorkspaceSpec is pure, but importing the module pulls in the pg pool —
// stub the DB modules so the test stays dependency-free.
vi.mock('./db/pool', () => ({ pool: { query: vi.fn() } }))
vi.mock('./db/workspaces', () => ({ getWorkspaceConfig: vi.fn() }))

import { buildWorkspaceSpec } from './placement'

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
    })
  })

  it('null config → platform defaults (claude-code, empty resources)', () => {
    expect(buildWorkspaceSpec(null, 1)).toEqual({
      agentType: 'claude-code',
      resources: {},
      version: 1,
    })
  })

  it('empty-string / null agent_type falls back to claude-code', () => {
    expect(buildWorkspaceSpec({ agent_type: '' }, 1).agentType).toBe('claude-code')
    expect(buildWorkspaceSpec({ agent_type: null }, 1).agentType).toBe('claude-code')
  })

  it('missing compute_resources → {} (never null/undefined on the wire)', () => {
    expect(buildWorkspaceSpec({ agent_type: 'codex' }, 2).resources).toEqual({})
  })

  it('static config (auto_scaling null/absent) projects no auto-scaling fields', () => {
    expect(buildWorkspaceSpec({ agent_type: 'codex', auto_scaling: null }, 1)).not.toHaveProperty(
      'runtimeMode',
    )
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
