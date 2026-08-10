import { describe, expect, it } from 'vitest'

// Subject under test lives in internal/env-runner-core/spec.ts; the unit suite
// only collects control-plane/src, so its tests live here alongside the
// reconcile-core ones.
import { toWorkspaceSpec } from '../../../internal/env-runner-core/spec'

describe('toWorkspaceSpec', () => {
  it('keeps a stated runtimeMode', () => {
    expect(
      toWorkspaceSpec({ agentType: 'codex', version: 2, runtimeMode: 'auto-scaling' }),
    ).toEqual({ agentType: 'codex', version: 2, runtimeMode: 'auto-scaling' })
  })

  // The single point allowed to supply the shape: rows written before the field
  // existed are single-replica Deployments.
  it('reads a spec with no runtimeMode as static', () => {
    expect(toWorkspaceSpec({ agentType: 'codex', version: 2 })).toEqual({
      agentType: 'codex',
      version: 2,
      runtimeMode: 'static',
    })
  })

  it('leaves the rest of the spec untouched when defaulting', () => {
    const raw = { agentType: 'codex', version: 2, resources: { cpu_limit: '2' }, replicas: 3 }

    expect(toWorkspaceSpec(raw)).toEqual({ ...raw, runtimeMode: 'static' })
  })
})
