import { pool } from './pool'
import type { Schedule } from './types'

const SCHEDULE_SELECT = `
  SELECT s.*, p.content AS prompt_content
  FROM schedules s
  LEFT JOIN prompts p ON s.prompt_id = p.id
`

export async function createSchedule(data: {
  workspace_id: string
  user_id: string
  name: string
  cron?: string | null
  run_at?: string | null
  timezone?: string
  prompt: string
  prompt_id?: string | null
  origin?: 'local' | 'template'
  enabled?: boolean
}): Promise<Schedule> {
  const { rows } = await pool.query(
    `INSERT INTO schedules (workspace_id, user_id, name, cron, run_at, timezone, prompt, prompt_id, origin, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      data.workspace_id,
      data.user_id,
      data.name,
      data.cron ?? null,
      data.run_at ?? null,
      data.timezone ?? 'UTC',
      data.prompt,
      data.prompt_id ?? null,
      data.origin ?? 'local',
      data.enabled ?? true,
    ],
  )
  return (await getSchedule(rows[0].id))!
}

export async function getSchedule(id: string): Promise<Schedule | null> {
  const { rows } = await pool.query(`${SCHEDULE_SELECT} WHERE s.id = $1`, [id])
  return rows[0] ?? null
}

export async function listSchedulesByWorkspace(workspaceId: string): Promise<Schedule[]> {
  const { rows } = await pool.query(
    `${SCHEDULE_SELECT} WHERE s.workspace_id = $1 ORDER BY s.created_at DESC`,
    [workspaceId],
  )
  return rows
}

export async function updateSchedule(
  id: string,
  updates: Partial<
    Pick<
      Schedule,
      | 'name'
      | 'cron'
      | 'run_at'
      | 'timezone'
      | 'prompt'
      | 'prompt_id'
      | 'enabled'
      | 'pgboss_job_id'
      | 'completed_at'
      | 'last_run_at'
    >
  >,
): Promise<Schedule | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1

  for (const field of [
    'name',
    'cron',
    'run_at',
    'timezone',
    'prompt',
    'prompt_id',
    'enabled',
    'pgboss_job_id',
    'completed_at',
    'last_run_at',
  ] as const) {
    if (updates[field] !== undefined) {
      sets.push(`${field} = $${idx++}`)
      values.push(updates[field])
    }
  }

  if (sets.length === 0) return await getSchedule(id)

  sets.push('updated_at = NOW()')
  values.push(id)
  await pool.query(`UPDATE schedules SET ${sets.join(', ')} WHERE id = $${idx}`, values)
  return await getSchedule(id)
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM schedules WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}
