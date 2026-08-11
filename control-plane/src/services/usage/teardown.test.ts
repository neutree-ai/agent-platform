import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTLE_GRACE_MS } from '../../../../internal/agent-usage/src/index'

vi.mock('./pull', () => ({ pullWorkspaceUsage: vi.fn() }))

import { pullWorkspaceUsage } from './pull'
import { UsageNotDrained, drainAfterStop, drainBeforeDelete } from './teardown'

const RUNNING = { id: 'ws1', user_id: 'alice', status: 'running' }

/** Long enough for the parser to consider the transcripts quiescent. */
const PAST_GRACE = DEFAULT_SETTLE_GRACE_MS + 5_000

function pullReturns(drained: boolean, stop = drained ? 'drained' : 'agent_unreachable') {
  vi.mocked(pullWorkspaceUsage).mockResolvedValue({ inserted: 0, drained, stop } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('drainBeforeDelete', () => {
  it('waits out the settle grace before reading', async () => {
    // Reading early risks ingesting a half-written record, which would then
    // block the finished one as a duplicate — a silent undercount.
    pullReturns(true)
    const p = drainBeforeDelete(RUNNING, Date.now(), false)

    await vi.advanceTimersByTimeAsync(DEFAULT_SETTLE_GRACE_MS - 1)
    expect(pullWorkspaceUsage).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(PAST_GRACE)
    await p
    expect(pullWorkspaceUsage).toHaveBeenCalledWith('ws1', 'alice')
  })

  it('does not wait again for time already spent tearing down', async () => {
    pullReturns(true)
    const startedAt = Date.now()
    await vi.advanceTimersByTimeAsync(PAST_GRACE)

    await drainBeforeDelete(RUNNING, startedAt, false)
    expect(pullWorkspaceUsage).toHaveBeenCalled()
  })

  it('refuses the delete when a running workspace cannot be read', async () => {
    pullReturns(false)
    const p = drainBeforeDelete(RUNNING, Date.now(), false)
    const assertion = expect(p).rejects.toBeInstanceOf(UsageNotDrained)
    await vi.advanceTimersByTimeAsync(PAST_GRACE)
    await assertion
  })

  it('deletes anyway under force, so a wedged agent cannot pin a workspace', async () => {
    pullReturns(false)
    const p = drainBeforeDelete(RUNNING, Date.now(), true)
    await vi.advanceTimersByTimeAsync(PAST_GRACE)
    await expect(p).resolves.toBeUndefined()
  })

  it.each(['stopped', 'error', 'deleting'])(
    'skips a %s workspace instead of demanding it be started first',
    async (status) => {
      await drainBeforeDelete({ ...RUNNING, status }, Date.now(), false)
      expect(pullWorkspaceUsage).not.toHaveBeenCalled()
    },
  )
})

describe('drainAfterStop', () => {
  it('reads after the grace without the caller waiting on it', async () => {
    pullReturns(true)
    // Returns void: a stop keeps its volume, so nothing here is worth blocking on.
    expect(drainAfterStop('ws1', 'alice', Date.now())).toBeUndefined()
    expect(pullWorkspaceUsage).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(PAST_GRACE)
    expect(pullWorkspaceUsage).toHaveBeenCalledWith('ws1', 'alice')
  })

  it('swallows a failed pull', async () => {
    // The pod is often already gone by now. Nothing is lost — the volume keeps
    // the records — so this must not surface as an unhandled rejection.
    vi.mocked(pullWorkspaceUsage).mockRejectedValue(new Error('pod gone'))
    drainAfterStop('ws1', 'alice', Date.now())

    await vi.advanceTimersByTimeAsync(PAST_GRACE)
    expect(pullWorkspaceUsage).toHaveBeenCalled()
  })
})
