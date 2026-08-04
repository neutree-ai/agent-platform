import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./pool', () => ({
  pool: { query: vi.fn() },
  generateId: () => 'tok1',
}))

import { pool } from './pool'
import {
  createWorkspaceToken,
  revokeAllWorkspaceTokens,
  sweepSupersededWorkspaceTokens,
  verifyWorkspaceToken,
} from './workspace-tokens'

const q = vi.mocked(pool.query)
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

beforeEach(() => {
  q.mockReset()
  q.mockResolvedValue({ rows: [], rowCount: 0 } as never)
})

describe('createWorkspaceToken', () => {
  it('returns the plaintext once and stores only its hash', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'tok1', created_at: 'now' }], rowCount: 1 } as never)

    const created = await createWorkspaceToken('ws1')

    expect(created.token).toMatch(/^ws_[0-9a-f]{64}$/)
    const [, params] = q.mock.calls[0]
    // The row carries the hash, never the secret itself — a token that is lost
    // has to be re-minted rather than read back out of the table.
    expect(params).toEqual(['tok1', 'ws1', sha256(created.token)])
    expect(JSON.stringify(params)).not.toContain(created.token)
  })

  it('mints a different secret every call', async () => {
    q.mockResolvedValue({ rows: [{ id: 'tok1', created_at: 'now' }], rowCount: 1 } as never)

    const a = await createWorkspaceToken('ws1')
    const b = await createWorkspaceToken('ws1')

    expect(a.token).not.toBe(b.token)
  })
})

describe('verifyWorkspaceToken', () => {
  it('looks the token up by hash and yields only a workspace id', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'tok1', workspace_id: 'ws1' }], rowCount: 1 } as never)

    const principal = await verifyWorkspaceToken('ws_secret')

    expect(principal).toEqual({ workspaceId: 'ws1' })
    expect(q.mock.calls[0][1]).toEqual([sha256('ws_secret')])
  })

  it('returns null for an unknown token', async () => {
    expect(await verifyWorkspaceToken('ws_nope')).toBeNull()
  })

  it('returns null for an empty token without hitting the database', async () => {
    expect(await verifyWorkspaceToken('')).toBeNull()
    expect(q).not.toHaveBeenCalled()
  })

  it('writes last_used_at at most once per window per token', async () => {
    const lookup = { rows: [{ id: 'throttled', workspace_id: 'ws1' }], rowCount: 1 }
    q.mockResolvedValue(lookup as never)

    await verifyWorkspaceToken('ws_a')
    await verifyWorkspaceToken('ws_a')
    await verifyWorkspaceToken('ws_a')

    // Three verifications, three lookups — but the breadcrumb is written once.
    const updates = q.mock.calls.filter(([sql]) => String(sql).includes('last_used_at = NOW()'))
    expect(updates).toHaveLength(1)
    expect(updates[0][1]).toEqual(['throttled'])
  })

  it('still resolves when the last_used_at write fails', async () => {
    q.mockResolvedValueOnce({
      rows: [{ id: 'breadcrumb-fails', workspace_id: 'ws1' }],
      rowCount: 1,
    } as never)
    q.mockRejectedValueOnce(new Error('write failed') as never)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    // A failed breadcrumb must never fail the request it describes.
    await expect(verifyWorkspaceToken('ws_b')).resolves.toEqual({ workspaceId: 'ws1' })
    consoleError.mockRestore()
  })
})

describe('revocation', () => {
  it('revokes every live token of a workspace', async () => {
    q.mockResolvedValueOnce({ rows: [], rowCount: 3 } as never)

    expect(await revokeAllWorkspaceTokens('ws1')).toBe(3)
    expect(q.mock.calls[0][1]).toEqual(['ws1'])
  })

  it('keeps the newest tokens per workspace and only retires past the grace window', async () => {
    q.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)

    await sweepSupersededWorkspaceTokens()

    // Default: keep 2 (so a rolling update can overlap), 1h grace in seconds.
    expect(q.mock.calls[0][1]).toEqual([2, 3600])
    // One set-based statement for the whole fleet, not a query per workspace.
    expect(String(q.mock.calls[0][0])).toContain('PARTITION BY workspace_id')
  })

  it('honours an explicit keep count and grace', async () => {
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)

    await sweepSupersededWorkspaceTokens(1, 5_000)

    expect(q.mock.calls[0][1]).toEqual([1, 5])
  })
})
