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
})
