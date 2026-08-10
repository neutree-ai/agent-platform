import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetObservedWatch,
  startObservedWatch,
} from '../../../internal/env-runner-core/reconcile'
import type {
  ObservedUpdate,
  PlacementTransport,
} from '../../../internal/env-runner-core/transport'
// Subject under test lives in internal/env-runner-core/reconcile.ts; the unit
// suite only collects control-plane/src, so its tests live here.
import type { EnvironmentProvider, ObservedState } from '../../../internal/types/environments'

/** Captures the change callback so a test can drive events by hand. */
function fakeProvider(withWatch = true) {
  let emit: ((workspaceId: string, state: ObservedState) => void) | undefined
  let closed = false
  const provider = {
    watch: withWatch
      ? (onChange: (workspaceId: string, state: ObservedState) => void) => {
          emit = onChange
          return {
            close() {
              closed = true
            },
          }
        }
      : undefined,
  } as unknown as EnvironmentProvider
  return {
    provider,
    fire: (workspaceId: string, state: ObservedState) => emit?.(workspaceId, state),
    isClosed: () => closed,
  }
}

function fakeTransport(fail = false) {
  const writes: [string, ObservedUpdate][] = []
  const transport = {
    writeObserved: vi.fn(async (workspaceId: string, o: ObservedUpdate) => {
      writes.push([workspaceId, o])
      if (fail) throw new Error('write failed')
    }),
  } as unknown as PlacementTransport
  return { transport, writes }
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetObservedWatch()
})

describe('startObservedWatch', () => {
  it('writes the observation a change event carries', async () => {
    const { provider, fire } = fakeProvider()
    const { transport, writes } = fakeTransport()

    startObservedWatch(provider, transport)
    fire('ws1', { phase: 'running', templateVersion: 8 })
    await vi.waitFor(() => expect(writes).toHaveLength(1))

    expect(writes[0][0]).toBe('ws1')
    expect(writes[0][1]).toMatchObject({ phase: 'running', templateVersion: 8, message: null })
  })

  // Convergence to a spec version is something an apply establishes; a watch
  // event says nothing about it, and writing one would falsely mark the
  // placement converged.
  it('never reports a spec version', async () => {
    const { provider, fire } = fakeProvider()
    const { transport, writes } = fakeTransport()

    startObservedWatch(provider, transport)
    fire('ws1', { phase: 'running', version: 7 })
    await vi.waitFor(() => expect(writes).toHaveLength(1))

    expect(writes[0][1].version).toBeUndefined()
  })

  // Events restate the world rather than describing a delta, so the same
  // observation arrives repeatedly; writing each one would be amplification.
  it('collapses repeats of an observation it already wrote', async () => {
    const { provider, fire } = fakeProvider()
    const { transport, writes } = fakeTransport()

    startObservedWatch(provider, transport)
    fire('ws1', { phase: 'running' })
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    fire('ws1', { phase: 'running' })
    fire('ws1', { phase: 'running' })

    expect(writes).toHaveLength(1)
  })

  // The signature is the same one the periodic pass compares, so the two
  // observers cannot disagree about what counts as new. `message` is left out of
  // it deliberately: today it only ever accompanies a phase change, and carrying
  // it would mean threading another column onto the placement row to compare
  // against.
  it.each([
    ['the phase moved', { phase: 'stopped' as const }],
    [
      'the ready replica set shifted',
      { phase: 'running' as const, endpoint: { readyReplicaIds: [0, 1] } },
    ],
    ['the template version changed', { phase: 'running' as const, templateVersion: 9 }],
  ])('writes again when %s', async (_label, next) => {
    const { provider, fire } = fakeProvider()
    const { transport, writes } = fakeTransport()

    startObservedWatch(provider, transport)
    fire('ws1', { phase: 'running' })
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    fire('ws1', next)
    await vi.waitFor(() => expect(writes).toHaveLength(2))
  })

  // A dropped write must not be remembered as written, or the workspace stays
  // stale until its state happens to change again.
  it('lets the next event retry after a failed write', async () => {
    const { provider, fire } = fakeProvider()
    const { transport, writes } = fakeTransport(true)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    startObservedWatch(provider, transport)
    fire('ws1', { phase: 'running' })
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    fire('ws1', { phase: 'running' })
    await vi.waitFor(() => expect(writes).toHaveLength(2))
  })

  it('is inert for a provider with no change stream', () => {
    const { provider } = fakeProvider(false)
    const { transport, writes } = fakeTransport()

    expect(startObservedWatch(provider, transport)).toBeUndefined()
    expect(writes).toHaveLength(0)
  })

  it('closes the provider stream when closed', () => {
    const { provider, isClosed } = fakeProvider()
    const { transport } = fakeTransport()

    startObservedWatch(provider, transport)?.close()

    expect(isClosed()).toBe(true)
  })
})
