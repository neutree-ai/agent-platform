import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Opt-in against a disposable PostgreSQL database; never uses DATABASE_URL.
const url = process.env.QUEUE_TEST_DATABASE_URL
const schema = `queue_test_${randomUUID().replaceAll('-', '')}`
const fixture = vi.hoisted(() => ({ pool: null as pg.Pool | null }))
vi.mock('./pool', () => ({
  pool: { query: (text: string, values?: unknown[]) => fixture.pool!.query(text, values) },
}))

const queue = await import('./session-message-queue')

describe.skipIf(!url)('session message queue PostgreSQL concurrency', () => {
  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: url })
    try {
      await admin.query(`CREATE SCHEMA ${schema}`)
    } finally {
      await admin.end()
    }
    fixture.pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    await fixture.pool.query(
      `CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT, status TEXT DEFAULT 'active', last_active_at TIMESTAMPTZ DEFAULT now(), turn_claim TEXT, turn_claim_expires_at TIMESTAMPTZ)`,
    )
    await fixture.pool.query(
      await readFile(
        new URL('../../../migrations/149_session_message_queue.sql', import.meta.url),
        'utf8',
      ),
    )
    await fixture.pool.query(`INSERT INTO sessions (id, workspace_id) VALUES ('s1', 'ws')`)
  })
  afterAll(async () => {
    await fixture.pool?.query(`DROP SCHEMA ${schema} CASCADE`)
    await fixture.pool?.end()
  })

  it('deduplicates concurrent retries, keeps FIFO across consumers, and recovers expired leases', async () => {
    const payload = { message: 'first', images: [], source: 'webhook', callerUserId: 'caller' }
    const ids = await Promise.all(
      Array.from({ length: 8 }, () => queue.enqueueSessionMessage('s1', 'same-key', payload)),
    )
    expect(new Set(ids).size).toBe(1)
    expect(
      await queue.enqueueSessionMessage('s1', 'same-key', { ...payload, message: 'changed' }),
    ).toBeNull()
    const second = await queue.enqueueSessionMessage('s1', 'second-key', {
      ...payload,
      message: 'second',
    })
    const claimed = await Promise.all(
      Array.from({ length: 8 }, (_, i) => queue.claimQueuedMessage('s1', `worker-${i}`)),
    )
    const owner = claimed.findIndex(Boolean)
    expect(claimed.filter(Boolean)).toHaveLength(1)
    expect(claimed[owner]?.id).toBe(ids[0])
    // A leased head must block the second entry, including across replicas.
    expect(await queue.claimQueuedMessage('s1', 'other')).toBeNull()
    await queue.finishQueuedMessage(ids[0]!, `worker-${owner}`, false)
    expect((await queue.claimQueuedMessage('s1', 'retry'))?.id).toBe(ids[0])
    await fixture.pool!.query(
      `UPDATE session_message_queue SET delivery_expires_at = now() - interval '1 second' WHERE id = $1`,
      [ids[0]],
    )
    expect((await queue.claimQueuedMessage('s1', 'recovered'))?.id).toBe(ids[0])
    await queue.finishQueuedMessage(ids[0]!, 'retry', true) // stale owner cannot acknowledge
    expect(await queue.claimQueuedMessage('s1', 'still-blocked')).toBeNull()
    await queue.finishQueuedMessage(ids[0]!, 'recovered', true)
    expect((await queue.claimQueuedMessage('s1', 'next'))?.id).toBe(second)
    await queue.finishQueuedMessage(second!, 'next', true)
    expect(await queue.claimQueuedMessage('s1', 'done')).toBeNull()
    // A retried completed callback returns the original id, without replaying.
    expect(await queue.enqueueSessionMessage('s1', 'same-key', payload)).toBe(ids[0])
    expect(await queue.claimQueuedMessage('s1', 'no-replay')).toBeNull()
  })
})
