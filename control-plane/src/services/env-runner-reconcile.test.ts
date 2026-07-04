import { describe, expect, it } from 'vitest'
import { reconcileOnce } from '../../../internal/env-runner-core/reconcile'
import type {
  ObservedUpdate,
  PlacementRow,
  PlacementTransport,
} from '../../../internal/env-runner-core/transport'
import type { ComputeResources } from '../../../internal/types/api'
import type {
  Capabilities,
  EnvironmentProvider,
  ObservedState,
  WorkspaceSpec,
} from '../../../internal/types/environments'

// Subject under test lives in internal/env-runner-core/reconcile.ts (the
// provider-/transport-agnostic reconcile decision table). The unit test is
// hosted here in control-plane/src because that's where vitest's include
// pattern points — same precedent as k8s-deployment-spec.test.ts, which tests
// shared code from control-plane.
//
// Each test wires a fake EnvironmentProvider + PlacementTransport that record
// their calls, drives a single reconcileOnce pass, and asserts which infra
// mutations / write-backs the decision table produced.

type Call = { method: string; args: unknown[] }

const CAPS: Capabilities = { sharedFs: true, persistentMemory: false }

const RESOURCES: ComputeResources = {
  cpu_request: '250m',
  cpu_limit: '1000m',
  memory_request: '512Mi',
  memory_limit: '1Gi',
  storage: '10Gi',
}

function makeSpec(version: number): WorkspaceSpec {
  return { agentType: 'claude-code', resources: RESOURCES, version }
}

class FakeProvider implements EnvironmentProvider {
  calls: Call[] = []
  // Point-in-time observe() results, keyed by workspace id. Used both for the
  // per-placement "current" observation (when observeAll is absent) and for the
  // post-mutation re-observe reconcilePlacement does after apply/start/stop.
  observeResults = new Map<string, ObservedState>()
  // Workspace ids whose observe() should throw, to exercise the failure path.
  observeThrows = new Set<string>()
  // Present only when constructed with a batch map — leaving it undefined makes
  // reconcileOnce take the per-placement observe() fallback.
  observeAll?: () => Promise<Map<string, ObservedState>>

  constructor(opts?: { observeAll?: Map<string, ObservedState>; capabilities?: Capabilities }) {
    this.caps = opts?.capabilities ?? CAPS
    if (opts?.observeAll) {
      const map = opts.observeAll
      this.observeAll = async () => {
        this.calls.push({ method: 'observeAll', args: [] })
        return map
      }
    }
  }

  private caps: Capabilities

  observe = async (workspaceId: string): Promise<ObservedState> => {
    this.calls.push({ method: 'observe', args: [workspaceId] })
    if (this.observeThrows.has(workspaceId)) throw new Error(`observe boom for ${workspaceId}`)
    return this.observeResults.get(workspaceId) ?? { phase: 'unknown' }
  }
  apply = async (workspaceId: string, spec: WorkspaceSpec): Promise<void> => {
    this.calls.push({ method: 'apply', args: [workspaceId, spec] })
  }
  start = async (workspaceId: string): Promise<void> => {
    this.calls.push({ method: 'start', args: [workspaceId] })
  }
  stop = async (workspaceId: string): Promise<void> => {
    this.calls.push({ method: 'stop', args: [workspaceId] })
  }
  destroy = async (workspaceId: string): Promise<void> => {
    this.calls.push({ method: 'destroy', args: [workspaceId] })
  }
  resize = async (workspaceId: string, resources: ComputeResources): Promise<void> => {
    this.calls.push({ method: 'resize', args: [workspaceId, resources] })
  }
  expandStorage = async (workspaceId: string, sizeGi: number): Promise<void> => {
    this.calls.push({ method: 'expandStorage', args: [workspaceId, sizeGi] })
  }
  capabilities = (): Capabilities => {
    this.calls.push({ method: 'capabilities', args: [] })
    return this.caps
  }

  count(method: string): number {
    return this.calls.filter((c) => c.method === method).length
  }
}

class FakeTransport implements PlacementTransport {
  calls: Call[] = []
  heartbeatThrows = false

  constructor(private placements: PlacementRow[]) {}

  listPlacements = async (): Promise<PlacementRow[]> => {
    this.calls.push({ method: 'listPlacements', args: [] })
    return this.placements
  }
  writeObserved = async (workspaceId: string, o: ObservedUpdate): Promise<void> => {
    this.calls.push({ method: 'writeObserved', args: [workspaceId, o] })
  }
  deletePlacement = async (workspaceId: string): Promise<void> => {
    this.calls.push({ method: 'deletePlacement', args: [workspaceId] })
  }
  heartbeat = async (capabilities: Record<string, unknown>): Promise<void> => {
    this.calls.push({ method: 'heartbeat', args: [capabilities] })
    if (this.heartbeatThrows) throw new Error('heartbeat boom')
  }

  count(method: string): number {
    return this.calls.filter((c) => c.method === method).length
  }
  writes(): ObservedUpdate[] {
    return this.calls
      .filter((c) => c.method === 'writeObserved')
      .map((c) => c.args[1] as ObservedUpdate)
  }
}

function placement(over: Partial<PlacementRow>): PlacementRow {
  return {
    workspace_id: 'ws1',
    environment_id: 'env1',
    desired_phase: 'running',
    spec: makeSpec(1),
    spec_version: 1,
    observed_phase: 'running',
    observed_version: 1,
    ...over,
  }
}

describe('reconcileOnce decision table', () => {
  it('desired=deleted → provider.destroy + transport.deletePlacement, counted as acted', async () => {
    const provider = new FakeProvider({ observeAll: new Map([['ws1', { phase: 'running' }]]) })
    const transport = new FakeTransport([placement({ desired_phase: 'deleted' })])

    const result = await reconcileOnce(provider, transport)

    expect(provider.count('destroy')).toBe(1)
    expect(transport.count('deletePlacement')).toBe(1)
    expect(result).toMatchObject({ acted: 1, noop: 0, failed: 0 })
  })

  it('desired=stopped, observed running → provider.stop + writeObserved with post-stop observation', async () => {
    const provider = new FakeProvider({ observeAll: new Map([['ws1', { phase: 'running' }]]) })
    provider.observeResults.set('ws1', { phase: 'stopped' }) // post-stop re-observe
    const transport = new FakeTransport([
      placement({ desired_phase: 'stopped', observed_phase: 'running' }),
    ])

    const result = await reconcileOnce(provider, transport)

    expect(provider.count('stop')).toBe(1)
    expect(transport.writes()).toEqual([{ phase: 'stopped', endpoint: undefined }])
    expect(result).toMatchObject({ acted: 1, failed: 0 })
  })

  it('desired=stopped, observed stopped → no provider calls, no writeObserved (phase unchanged)', async () => {
    const provider = new FakeProvider({ observeAll: new Map([['ws1', { phase: 'stopped' }]]) })
    const transport = new FakeTransport([
      placement({ desired_phase: 'stopped', observed_phase: 'stopped' }),
    ])

    const result = await reconcileOnce(provider, transport)

    expect(provider.count('stop')).toBe(0)
    expect(provider.count('observe')).toBe(0)
    expect(transport.count('writeObserved')).toBe(0)
    expect(result).toMatchObject({ acted: 0, noop: 1, failed: 0 })
  })

  it('desired=stopped, phase unknown (not provisioned) → no stop call', async () => {
    const provider = new FakeProvider({ observeAll: new Map() }) // ws1 absent → unknown
    const transport = new FakeTransport([
      placement({ desired_phase: 'stopped', observed_phase: 'unknown' }),
    ])

    const result = await reconcileOnce(provider, transport)

    expect(provider.count('stop')).toBe(0)
    expect(transport.count('writeObserved')).toBe(0)
    expect(result).toMatchObject({ noop: 1 })
  })

  it('desired=running, spec_version > observed_version → provider.apply with the spec + writeObserved carrying version', async () => {
    const spec = makeSpec(2)
    const provider = new FakeProvider({ observeAll: new Map([['ws1', { phase: 'running' }]]) })
    provider.observeResults.set('ws1', { phase: 'running' }) // post-apply re-observe
    const transport = new FakeTransport([
      placement({ desired_phase: 'running', spec, spec_version: 2, observed_version: 1 }),
    ])

    const result = await reconcileOnce(provider, transport)

    const applies = provider.calls.filter((c) => c.method === 'apply')
    expect(applies).toHaveLength(1)
    expect(applies[0].args[1]).toBe(spec)
    expect(transport.writes()).toEqual([{ phase: 'running', endpoint: undefined, version: 2 }])
    expect(result).toMatchObject({ acted: 1 })
  })

  it('desired=running, phase unknown → provider.apply (create path) + writeObserved', async () => {
    const provider = new FakeProvider({ observeAll: new Map() }) // ws1 absent → unknown
    provider.observeResults.set('ws1', { phase: 'starting' }) // post-apply re-observe
    const transport = new FakeTransport([
      placement({ desired_phase: 'running', spec_version: 1, observed_version: 1 }),
    ])

    const result = await reconcileOnce(provider, transport)

    expect(provider.count('apply')).toBe(1)
    expect(transport.writes()).toEqual([{ phase: 'starting', endpoint: undefined, version: 1 }])
    expect(result).toMatchObject({ acted: 1 })
  })

  it('desired=running, phase stopped → provider.start + writeObserved', async () => {
    const provider = new FakeProvider({ observeAll: new Map([['ws1', { phase: 'stopped' }]]) })
    provider.observeResults.set('ws1', { phase: 'running' }) // post-start re-observe
    const transport = new FakeTransport([
      placement({
        desired_phase: 'running',
        observed_phase: 'stopped',
        spec_version: 1,
        observed_version: 1,
      }),
    ])

    const result = await reconcileOnce(provider, transport)

    expect(provider.count('start')).toBe(1)
    expect(provider.count('apply')).toBe(0)
    expect(transport.writes()).toEqual([{ phase: 'running', endpoint: undefined }])
    expect(result).toMatchObject({ acted: 1 })
  })

  it('desired=running, phase starting → no mutation, writeObserved only because phase differs from observed_phase', async () => {
    const provider = new FakeProvider({ observeAll: new Map([['ws1', { phase: 'starting' }]]) })
    const transport = new FakeTransport([
      placement({
        desired_phase: 'running',
        observed_phase: 'pending',
        spec_version: 1,
        observed_version: 1,
      }),
    ])

    const result = await reconcileOnce(provider, transport)

    expect(provider.count('apply')).toBe(0)
    expect(provider.count('start')).toBe(0)
    expect(provider.count('stop')).toBe(0)
    expect(transport.writes()).toEqual([{ phase: 'starting', endpoint: undefined }])
    expect(result).toMatchObject({ noop: 1 })
  })

  it('converged (running/running, versions equal) → no provider mutation, no writeObserved when observed_phase already running', async () => {
    const provider = new FakeProvider({ observeAll: new Map([['ws1', { phase: 'running' }]]) })
    const transport = new FakeTransport([
      placement({
        desired_phase: 'running',
        observed_phase: 'running',
        spec_version: 1,
        observed_version: 1,
      }),
    ])

    const result = await reconcileOnce(provider, transport)

    expect(provider.count('apply')).toBe(0)
    expect(provider.count('start')).toBe(0)
    expect(provider.count('stop')).toBe(0)
    expect(transport.count('writeObserved')).toBe(0)
    expect(result).toMatchObject({ acted: 0, noop: 1, failed: 0 })
  })

  it('observeAll present → used once, provider.observe never called; placement absent from map treated as phase unknown', async () => {
    // wsA converged/running (present in the batch map, no post-action re-observe);
    // wsB absent from the map → must be treated as 'unknown'. If it were treated
    // as any live phase it would trigger stop()+observe(); asserting no stop
    // proves the unknown fallback.
    const provider = new FakeProvider({ observeAll: new Map([['wsA', { phase: 'running' }]]) })
    const transport = new FakeTransport([
      placement({
        workspace_id: 'wsA',
        desired_phase: 'running',
        observed_phase: 'running',
        spec_version: 1,
        observed_version: 1,
      }),
      placement({ workspace_id: 'wsB', desired_phase: 'stopped', observed_phase: 'unknown' }),
    ])

    const result = await reconcileOnce(provider, transport)

    expect(provider.count('observeAll')).toBe(1)
    expect(provider.count('observe')).toBe(0)
    expect(provider.count('stop')).toBe(0)
    expect(result).toMatchObject({ noop: 2, failed: 0 })
  })

  it('provider without observeAll → observe() called once per placement', async () => {
    const provider = new FakeProvider() // no observeAll
    provider.observeResults.set('wsA', { phase: 'running' })
    provider.observeResults.set('wsB', { phase: 'running' })
    const transport = new FakeTransport([
      placement({ workspace_id: 'wsA', observed_phase: 'running' }),
      placement({ workspace_id: 'wsB', observed_phase: 'running' }),
    ])

    const result = await reconcileOnce(provider, transport)

    expect(provider.observeAll).toBeUndefined()
    expect(provider.count('observe')).toBe(2)
    expect(transport.count('writeObserved')).toBe(0)
    expect(result).toMatchObject({ noop: 2, failed: 0 })
  })

  it('one placement throwing → other placements still reconciled, failed count reflects it', async () => {
    const provider = new FakeProvider() // per-placement observe
    provider.observeThrows.add('wsBad')
    provider.observeResults.set('wsGood', { phase: 'stopped' })
    const transport = new FakeTransport([
      placement({ workspace_id: 'wsBad' }),
      placement({
        workspace_id: 'wsGood',
        desired_phase: 'running',
        observed_phase: 'stopped',
        spec_version: 1,
        observed_version: 1,
      }),
    ])

    const result = await reconcileOnce(provider, transport)

    expect(result.failed).toBe(1)
    expect(provider.calls.some((c) => c.method === 'start' && c.args[0] === 'wsGood')).toBe(true)
    expect(result).toMatchObject({ acted: 1, failed: 1 })
  })

  it('heartbeat called once per pass with provider.capabilities(); heartbeat throwing does not throw out of reconcileOnce', async () => {
    const provider = new FakeProvider({ observeAll: new Map(), capabilities: CAPS })
    const transport = new FakeTransport([])

    await reconcileOnce(provider, transport)

    expect(transport.count('heartbeat')).toBe(1)
    const heartbeatCall = transport.calls.find((c) => c.method === 'heartbeat')
    expect(heartbeatCall?.args[0]).toEqual(CAPS)

    // A throwing heartbeat is swallowed — the pass still resolves.
    const throwing = new FakeTransport([])
    throwing.heartbeatThrows = true
    await expect(reconcileOnce(provider, throwing)).resolves.toMatchObject({ acted: 0 })
    expect(throwing.count('heartbeat')).toBe(1)
  })
})
