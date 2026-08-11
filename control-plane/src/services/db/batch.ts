import { pool } from './pool'
import type { BatchRun, BatchTask } from './types'

export async function createBatchRun(data: {
  user_id: string
  name: string
  concurrency?: number
}): Promise<BatchRun> {
  const { rows } = await pool.query(
    `INSERT INTO batch_runs (user_id, name, concurrency)
     VALUES ($1, $2, $3) RETURNING *`,
    [data.user_id, data.name, data.concurrency ?? 1],
  )
  return rows[0]
}

export async function getBatchRun(id: string): Promise<BatchRun | null> {
  const { rows } = await pool.query('SELECT * FROM batch_runs WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function listBatchRuns(userId: string): Promise<BatchRun[]> {
  const { rows } = await pool.query(
    'SELECT * FROM batch_runs WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  )
  return rows
}

export async function updateBatchRunStatus(
  id: string,
  status: string,
  stats?: unknown,
): Promise<void> {
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    await pool.query(
      'UPDATE batch_runs SET status = $1, stats = $2, completed_at = NOW() WHERE id = $3',
      [status, stats ? JSON.stringify(stats) : null, id],
    )
  } else {
    await pool.query('UPDATE batch_runs SET status = $1 WHERE id = $2', [status, id])
  }
}

export async function createBatchTask(data: {
  batch_run_id: string
  workspace_id: string
  prompt: string
}): Promise<BatchTask> {
  const { rows } = await pool.query(
    `INSERT INTO batch_tasks (batch_run_id, workspace_id, prompt)
     VALUES ($1, $2, $3) RETURNING *`,
    [data.batch_run_id, data.workspace_id, data.prompt],
  )
  return rows[0]
}

export async function updateBatchTask(
  id: string,
  updates: { status?: string; session_id?: string; error?: string },
): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (updates.status !== undefined) {
    sets.push(`status = $${idx++}`)
    values.push(updates.status)
    if (
      updates.status === 'completed' ||
      updates.status === 'failed' ||
      updates.status === 'cancelled'
    ) {
      sets.push('completed_at = NOW()')
    }
  }
  if (updates.session_id !== undefined) {
    sets.push(`session_id = $${idx++}`)
    values.push(updates.session_id)
  }
  if (updates.error !== undefined) {
    sets.push(`error = $${idx++}`)
    values.push(updates.error)
  }

  if (sets.length === 0) return

  values.push(id)
  await pool.query(`UPDATE batch_tasks SET ${sets.join(', ')} WHERE id = $${idx}`, values)
}

export async function listBatchTasks(batchRunId: string): Promise<BatchTask[]> {
  const { rows } = await pool.query(
    'SELECT * FROM batch_tasks WHERE batch_run_id = $1 ORDER BY created_at ASC',
    [batchRunId],
  )
  return rows
}

/**
 * Task counts plus what the run's sessions spent.
 *
 * The tokens come from the usage ledger. They used to come from
 * `sessions.last_turn_stats`, which held one turn's snapshot — summing those
 * across tasks counted only each session's final turn, and once token
 * accounting moved to the ledger the fields stopped being written at all, so
 * the totals were a constant zero. The ledger has every turn, and keeps them
 * after the session is deleted.
 *
 * No money: there is no pricing layer yet, and cache-read tokens (often tens of
 * times the input volume, at a fraction of the price) make raw token counts a
 * poor stand-in for one. They stay in their own column for whoever prices them.
 */
export async function getBatchRunStats(batchRunId: string): Promise<{
  total: number
  queued: number
  running: number
  completed: number
  failed: number
  cancelled: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_read_tokens: number
  total_cache_creation_tokens: number
}> {
  // LATERAL, not a join to the ledger: a task with 300 usage rows would
  // otherwise appear 300 times and multiply every status count with it.
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE bt.status = 'queued')::int AS queued,
       COUNT(*) FILTER (WHERE bt.status = 'running')::int AS running,
       COUNT(*) FILTER (WHERE bt.status = 'completed')::int AS completed,
       COUNT(*) FILTER (WHERE bt.status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE bt.status = 'cancelled')::int AS cancelled,
       COALESCE(SUM(u.input_tokens), 0)::bigint          AS total_input_tokens,
       COALESCE(SUM(u.output_tokens), 0)::bigint         AS total_output_tokens,
       COALESCE(SUM(u.cache_read_tokens), 0)::bigint     AS total_cache_read_tokens,
       COALESCE(SUM(u.cache_creation_tokens), 0)::bigint AS total_cache_creation_tokens
     FROM batch_tasks bt
     LEFT JOIN LATERAL (
       SELECT SUM(e.input_tokens)          AS input_tokens,
              SUM(e.output_tokens)         AS output_tokens,
              SUM(e.cache_read_tokens)     AS cache_read_tokens,
              SUM(e.cache_creation_tokens) AS cache_creation_tokens
         FROM workspace_usage_events e
        WHERE e.session_id = bt.session_id
     ) u ON TRUE
     WHERE bt.batch_run_id = $1`,
    [batchRunId],
  )
  const r = rows[0]
  return {
    total: r.total,
    queued: r.queued,
    running: r.running,
    completed: r.completed,
    failed: r.failed,
    cancelled: r.cancelled,
    // pg returns bigint as string; the counts above are already int.
    total_input_tokens: Number(r.total_input_tokens),
    total_output_tokens: Number(r.total_output_tokens),
    total_cache_read_tokens: Number(r.total_cache_read_tokens),
    total_cache_creation_tokens: Number(r.total_cache_creation_tokens),
  }
}
