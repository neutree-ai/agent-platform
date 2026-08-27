import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./pool', () => ({ pool: { query: vi.fn() }, generateId: vi.fn(() => 'gen-id') }))

import { getMessages } from './messages'
import { pool } from './pool'

const q = vi.mocked(pool.query)

beforeEach(() => {
  q.mockReset()
  q.mockResolvedValue({ rows: [], rowCount: 0 } as never)
})

describe('getMessages', () => {
  it('fetches the full history when no pagination is given', async () => {
    await getMessages('ws1', 'sess1')

    const [sql, params] = q.mock.calls[0]
    expect(String(sql)).not.toContain('LIMIT')
    expect(String(sql)).not.toContain('OFFSET')
    expect(params).toEqual(['ws1', 'sess1'])
  })

  it('appends LIMIT and OFFSET as trailing bound params', async () => {
    await getMessages('ws1', 'sess1', { limit: 50, offset: 100 })

    const [sql, params] = q.mock.calls[0]
    expect(String(sql)).toContain('LIMIT $3')
    expect(String(sql)).toContain('OFFSET $4')
    expect(params).toEqual(['ws1', 'sess1', 50, 100])
  })

  it('supports limit without offset', async () => {
    await getMessages('ws1', 'sess1', { limit: 20 })

    const [sql, params] = q.mock.calls[0]
    expect(String(sql)).toContain('LIMIT $3')
    expect(String(sql)).not.toContain('OFFSET')
    expect(params).toEqual(['ws1', 'sess1', 20])
  })
})
