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

export async function getBatchRunStats(batchRunId: string): Promise<{
  total: number
  queued: number
  running: number
  completed: number
  failed: number
  cancelled: number
  total_cost_usd: number
  total_duration_ms: number
}> {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE bt.status = 'queued')::int AS queued,
       COUNT(*) FILTER (WHERE bt.status = 'running')::int AS running,
       COUNT(*) FILTER (WHERE bt.status = 'completed')::int AS completed,
       COUNT(*) FILTER (WHERE bt.status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE bt.status = 'cancelled')::int AS cancelled,
       COALESCE(SUM((s.last_turn_stats->>'costUsd')::numeric), 0)::float AS total_cost_usd,
       COALESCE(SUM((s.last_turn_stats->>'durationMs')::numeric), 0)::float AS total_duration_ms
     FROM batch_tasks bt
     LEFT JOIN sessions s ON s.id = bt.session_id
     WHERE bt.batch_run_id = $1`,
    [batchRunId],
  )
  return rows[0]
}
