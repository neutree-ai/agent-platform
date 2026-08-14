import { describe, expect, it } from 'vitest'
import type { WorkspaceFootprint } from './db/resource-usage'
import { summarizeFootprints } from './resource-usage'

function footprint(over: Partial<WorkspaceFootprint> = {}): WorkspaceFootprint {
  return {
    workspaceId: 'ws1',
    name: 'ws1',
    status: 'running',
    autoScaling: false,
    coreRequest: 1,
    storageGib: 10,
    lastUsed: '2026-08-01T00:00:00.000Z',
    idleDays: 0,
    ...over,
  }
}

const THRESHOLD = { idleDays: 3 }

describe('summarizeFootprints', () => {
  it('calls a running workspace idle only past the threshold', () => {
    const { idle } = summarizeFootprints(
      [
        footprint({ workspaceId: 'fresh', idleDays: 2.9 }),
        footprint({ workspaceId: 'stale', idleDays: 3.1 }),
      ],
      { fresh: 1, stale: 1 },
      THRESHOLD,
    )
    expect(idle.map((w) => w.workspaceId)).toEqual(['stale'])
  })

  it('leaves auto-scaling workspaces out — the autoscaler owns their idleness', () => {
    const { idle } = summarizeFootprints(
      [footprint({ idleDays: 30, autoScaling: true })],
      { ws1: 12 },
      THRESHOLD,
    )
    expect(idle).toEqual([])
  })

  it('never counts a stopped workspace as idle compute', () => {
    const { idle } = summarizeFootprints(
      [footprint({ status: 'stopped', idleDays: 30 })],
      { ws1: 12 },
      THRESHOLD,
    )
    expect(idle).toEqual([])
  })

  it('reports measured idle hours, not hours projected from the idle days', () => {
    // Idle for 100 days, but the meter only ever observed 12 core-hours of it.
    const { idle } = summarizeFootprints(
      [footprint({ idleDays: 100, coreRequest: 4 })],
      { ws1: 12 },
      THRESHOLD,
    )
    expect(idle[0].coreHours).toBe(12)
  })

  it('reports zero rather than NaN when the meter saw nothing for a workspace', () => {
    const { idle } = summarizeFootprints([footprint({ idleDays: 10 })], {}, THRESHOLD)
    expect(idle[0].coreHours).toBe(0)
  })

  it('counts disk for every live workspace, not just the stopped ones', () => {
    const { storage } = summarizeFootprints(
      [
        footprint({ workspaceId: 'up', status: 'running', storageGib: 10 }),
        footprint({ workspaceId: 'down', status: 'stopped', storageGib: 50 }),
      ],
      {},
      THRESHOLD,
    )
    expect(storage.totalGib).toBe(60)
    expect(storage.stopped.map((w) => w.workspaceId)).toEqual(['down'])
  })

  it('ranks each list by what reclaiming it returns', () => {
    const { idle, storage } = summarizeFootprints(
      [
        footprint({ workspaceId: 'small', idleDays: 10 }),
        footprint({ workspaceId: 'big', idleDays: 10 }),
        footprint({ workspaceId: 'disk', status: 'stopped', storageGib: 100 }),
        footprint({ workspaceId: 'disk2', status: 'stopped', storageGib: 50 }),
      ],
      { small: 2, big: 40 },
      THRESHOLD,
    )
    expect(idle.map((w) => w.workspaceId)).toEqual(['big', 'small'])
    expect(storage.stopped.map((w) => w.workspaceId)).toEqual(['disk', 'disk2'])
  })
})
