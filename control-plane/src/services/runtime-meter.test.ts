import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeMeterRow } from './db/runtime-meter'

vi.mock('./db/runtime-meter', () => ({
  listRuntimeMeterRows: vi.fn(),
  insertRuntimeEvents: vi.fn().mockResolvedValue(0),
  markMeterCoverage: vi.fn().mockResolvedValue(null),
  closeDeletedWorkspaceIntervals: vi.fn().mockResolvedValue([]),
}))

import { insertRuntimeEvents, listRuntimeMeterRows, markMeterCoverage } from './db/runtime-meter'
import { runRuntimeMeter, stateChanged } from './runtime-meter'

/** A workspace running steadily: current observation equals what was last logged. */
function steady(over: Partial<RuntimeMeterRow> = {}): RuntimeMeterRow {
  return {
    workspace_id: 'ws1',
    user_id: 'u1',
    phase: 'running',
    ready_replicas: 1,
    desired_replicas: 1,
    runtime_mode: 'static',
    resources: { cpu_request: '1000m', cpu_limit: '4000m' },
    spec_version: 3,
    observed_template_version: 3,
    env_offline: false,
    last_phase: 'running',
    last_ready_replicas: 1,
    last_desired_replicas: 1,
    last_spec_version: 3,
    last_observed_template_version: 3,
    last_env_offline: false,
    ...over,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('stateChanged', () => {
  it('is false while the observation matches the newest logged row', () => {
    expect(stateChanged(steady())).toBe(false)
  })

  it('is true for a workspace with nothing logged yet (needs an opening anchor)', () => {
    expect(
      stateChanged(
        steady({
          last_phase: null,
          last_ready_replicas: null,
          last_desired_replicas: null,
          last_spec_version: null,
          last_observed_template_version: null,
          last_env_offline: null,
        }),
      ),
    ).toBe(true)
  })

  it('is true when only the replica count moved — the case a status hook would miss', () => {
    expect(stateChanged(steady({ ready_replicas: 3, desired_replicas: 3 }))).toBe(true)
  })

  it('is true when only the spec version moved (a resize, status still running)', () => {
    expect(stateChanged(steady({ spec_version: 4 }))).toBe(true)
  })

  it('is true when the pod template caught up to a new spec', () => {
    expect(
      stateChanged(steady({ observed_template_version: 4, last_observed_template_version: 3 })),
    ).toBe(true)
  })

  it('is true when the environment went offline, so the phase is no longer a live reading', () => {
    expect(stateChanged(steady({ env_offline: true }))).toBe(true)
  })

  it('distinguishes "no ready set reported" from "an empty ready set"', () => {
    expect(stateChanged(steady({ ready_replicas: null, last_ready_replicas: 0 }))).toBe(true)
  })
})

describe('runRuntimeMeter', () => {
  it('writes nothing at steady state, but still marks coverage', async () => {
    vi.mocked(listRuntimeMeterRows).mockResolvedValue([steady(), steady({ workspace_id: 'ws2' })])

    await runRuntimeMeter(60)

    expect(insertRuntimeEvents).not.toHaveBeenCalled()
    expect(markMeterCoverage).toHaveBeenCalled()
  })

  it('logs only the moved workspaces, without the comparison columns', async () => {
    vi.mocked(listRuntimeMeterRows).mockResolvedValue([
      steady(),
      steady({ workspace_id: 'ws2', phase: 'stopped', ready_replicas: 0 }),
    ])

    await runRuntimeMeter(60)

    expect(insertRuntimeEvents).toHaveBeenCalledWith([
      {
        workspace_id: 'ws2',
        user_id: 'u1',
        phase: 'stopped',
        ready_replicas: 0,
        desired_replicas: 1,
        runtime_mode: 'static',
        resources: { cpu_request: '1000m', cpu_limit: '4000m' },
        spec_version: 3,
        observed_template_version: 3,
        env_offline: false,
      },
    ])
  })

  it('leaves coverage un-extended when the write fails, so a real outage is recorded', async () => {
    vi.mocked(listRuntimeMeterRows).mockResolvedValue([steady({ phase: 'error' })])
    vi.mocked(insertRuntimeEvents).mockRejectedValueOnce(new Error('db down'))

    await expect(runRuntimeMeter(60)).rejects.toThrow('db down')
    expect(markMeterCoverage).not.toHaveBeenCalled()
  })
})
