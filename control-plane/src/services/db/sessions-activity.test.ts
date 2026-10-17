import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./pool', () => ({ pool: { query: vi.fn() } }))

import { pool } from './pool'
import { getUserActivitySummary } from './sessions'

const query = vi.mocked(pool.query)
beforeEach(() => {
  query.mockReset()
  query.mockResolvedValue({ rows: [], rowCount: 0 } as never)
})

describe('getUserActivitySummary', () => {
  it('only reads the scheduled statistics snapshot and live user activity', async () => {
    await getUserActivitySummary('user1', 30)
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[0][0]).toContain('LEFT JOIN user_daily_interactions')
    expect(query.mock.calls[0][1]).toEqual(['user1', 29])
    expect(query.mock.calls[1][1]).toEqual(['user1', 29])
    for (const [sql] of query.mock.calls) {
      expect(String(sql)).not.toMatch(/REFRESH|pg_matviews/)
    }
  })
})
