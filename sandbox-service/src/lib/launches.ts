import { pool } from './db'

interface LaunchRow {
  sandbox_id: string
  owner_id: string
  image: string
  resource: Record<string, string>
  entrypoint: string[] | null
  metadata: Record<string, string>
  created_at: Date | string
  expires_at: Date | string | null
  renew_count: number
  last_renewed_at: Date | string | null
}

export async function recordLaunch(input: {
  sandboxId: string
  ownerId: string
  image: string
  resource: Record<string, string>
  entrypoint?: string[]
  metadata: Record<string, string>
  expiresAt: string | null
}): Promise<void> {
  await pool.query(
    `INSERT INTO sandbox.launches
       (sandbox_id, owner_id, image, resource, entrypoint, metadata, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7)
     ON CONFLICT (sandbox_id) DO NOTHING`,
    [
      input.sandboxId,
      input.ownerId,
      input.image,
      JSON.stringify(input.resource),
      input.entrypoint ?? null,
      JSON.stringify(input.metadata),
      input.expiresAt,
    ],
  )
}

export async function recordRenew(sandboxId: string, expiresAt: string): Promise<void> {
  await pool.query(
    `UPDATE sandbox.launches
       SET expires_at = $2,
           renew_count = renew_count + 1,
           last_renewed_at = NOW()
     WHERE sandbox_id = $1`,
    [sandboxId, expiresAt],
  )
}

interface ListLaunchesOpts {
  ownerId?: string
  limit?: number
  before?: string
}

export async function listLaunches(opts: ListLaunchesOpts = {}): Promise<LaunchRow[]> {
  const params: any[] = []
  const where: string[] = []
  if (opts.ownerId) {
    params.push(opts.ownerId)
    where.push(`owner_id = $${params.length}`)
  }
  if (opts.before) {
    params.push(opts.before)
    where.push(`created_at < $${params.length}`)
  }
  const limit = Math.min(opts.limit ?? 100, 500)
  params.push(limit)

  const sql = `
    SELECT sandbox_id, owner_id, image, resource, entrypoint, metadata,
           created_at, expires_at, renew_count, last_renewed_at
      FROM sandbox.launches
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC
     LIMIT $${params.length}
  `
  const { rows } = await pool.query(sql, params)
  return rows
}
