import { createHash } from 'node:crypto'
import { generateId, pool } from './pool'

export type MemoryAccess = 'read_only' | 'read_write'
type VersionOp = 'create' | 'update' | 'delete' | 'rename' | 'migrate'
type ActorKind = 'user' | 'agent' | 'reflect' | 'migrate'

interface MemoryStoreRow {
  id: string
  owner_user_id: string
  name: string
  description: string
  archived_at: string | null
  created_at: string
  updated_at: string
}

interface MemoryStoreWithCounts extends MemoryStoreRow {
  memory_count: number
}

interface MemoryRow {
  id: string
  store_id: string
  path: string
  content: string
  content_sha256: string
  size_bytes: number
  description: string
  mem_type: string | null
  created_at: string
  updated_at: string
}

interface AttachmentRow {
  workspace_id: string
  store_id: string
  store_name: string
  store_description: string
  access: MemoryAccess
  instructions: string
  created_at: string
}

interface VersionRow {
  id: string
  store_id: string
  memory_id: string | null
  path: string
  operation: VersionOp
  content_sha256: string | null
  size_bytes: number | null
  actor_kind: ActorKind
  actor_id: string | null
  created_at: string
  /** Sequential per-(store_id, path) numbering when listed by path; null in store-wide mode. */
  version_number: number | null
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

const STORE_COLS_WITH_COUNTS = `s.id, s.owner_user_id, s.name, s.description,
  s.archived_at, s.created_at, s.updated_at,
  COALESCE(c.memory_count, 0)::int AS memory_count`

const STORE_COUNT_JOIN = `LEFT JOIN (
  SELECT store_id, COUNT(*) AS memory_count
    FROM memories GROUP BY store_id
) c ON c.store_id = s.id`

// ── Stores ──────────────────────────────────────────────────────────────────

export async function listStoresForUser(
  userId: string,
  includeArchived = false,
): Promise<MemoryStoreWithCounts[]> {
  const { rows } = await pool.query(
    `SELECT ${STORE_COLS_WITH_COUNTS}
       FROM memory_stores s ${STORE_COUNT_JOIN}
      WHERE s.owner_user_id = $1
        ${includeArchived ? '' : 'AND s.archived_at IS NULL'}
      ORDER BY s.name`,
    [userId],
  )
  return rows
}

export async function getStoreById(id: string): Promise<MemoryStoreWithCounts | null> {
  const { rows } = await pool.query(
    `SELECT ${STORE_COLS_WITH_COUNTS}
       FROM memory_stores s ${STORE_COUNT_JOIN}
      WHERE s.id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function createStore(input: {
  ownerUserId: string
  name: string
  description?: string
}): Promise<MemoryStoreWithCounts> {
  const id = generateId()
  await pool.query(
    `INSERT INTO memory_stores (id, owner_user_id, name, description)
     VALUES ($1, $2, $3, $4)`,
    [id, input.ownerUserId, input.name, input.description ?? ''],
  )
  return (await getStoreById(id))!
}

export async function patchStore(
  id: string,
  patch: {
    name?: string
    description?: string
    archived?: boolean
  },
): Promise<MemoryStoreWithCounts | null> {
  const existing = await getStoreById(id)
  if (!existing) return null

  const sets: string[] = []
  const params: unknown[] = []
  let i = 1
  const push = (col: string, val: unknown) => {
    sets.push(`${col} = $${i++}`)
    params.push(val)
  }
  if (patch.name !== undefined) push('name', patch.name)
  if (patch.description !== undefined) push('description', patch.description)
  if (patch.archived !== undefined)
    push('archived_at', patch.archived ? new Date().toISOString() : null)
  if (sets.length === 0) return existing

  sets.push('updated_at = NOW()')
  params.push(id)
  await pool.query(`UPDATE memory_stores SET ${sets.join(', ')} WHERE id = $${i}`, params)
  return getStoreById(id)
}

export async function deleteStore(id: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM memory_stores WHERE id = $1', [id])
  return (r.rowCount ?? 0) > 0
}

// ── Memories ────────────────────────────────────────────────────────────────

export async function listMemories(storeId: string): Promise<Omit<MemoryRow, 'content'>[]> {
  const { rows } = await pool.query(
    `SELECT id, store_id, path, content_sha256, size_bytes, description, mem_type, created_at, updated_at
       FROM memories WHERE store_id = $1 ORDER BY path`,
    [storeId],
  )
  return rows
}

export async function getMemoryByPath(storeId: string, path: string): Promise<MemoryRow | null> {
  const { rows } = await pool.query(
    `SELECT id, store_id, path, content, content_sha256, size_bytes, description, mem_type, created_at, updated_at
       FROM memories WHERE store_id = $1 AND path = $2`,
    [storeId, path],
  )
  return rows[0] ?? null
}

export class PreconditionFailedError extends Error {
  constructor(public readonly currentSha: string | null) {
    super('precondition failed')
  }
}

export class PathConflictError extends Error {
  constructor() {
    super('path already exists')
  }
}

/**
 * Upsert a memory at (store_id, path).
 *
 * Concurrency model (CMA-aligned):
 *   - if_match_sha256 omitted  → create-only; throws PathConflictError if path exists
 *   - if_match_sha256 = ''     → assert path must not exist; same as omitted
 *   - if_match_sha256 = <hex>  → must match current sha; otherwise PreconditionFailedError
 *
 * Records a version row in the same transaction.
 */
export async function putMemory(input: {
  storeId: string
  path: string
  content: string
  description?: string
  memType?: string
  ifMatchSha256?: string
  actorKind: ActorKind
  actorId: string | null
}): Promise<MemoryRow> {
  const newSha = sha256(input.content)
  const sizeBytes = Buffer.byteLength(input.content, 'utf8')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query<MemoryRow>(
      `SELECT id, store_id, path, content, content_sha256, size_bytes, description, mem_type, created_at, updated_at
         FROM memories WHERE store_id = $1 AND path = $2 FOR UPDATE`,
      [input.storeId, input.path],
    )
    const row = existing.rows[0]

    if (row) {
      if (input.ifMatchSha256 === undefined || input.ifMatchSha256 === '') {
        throw new PathConflictError()
      }
      if (input.ifMatchSha256 !== row.content_sha256) {
        throw new PreconditionFailedError(row.content_sha256)
      }
      const updated = await client.query<MemoryRow>(
        `UPDATE memories
            SET content = $1, content_sha256 = $2, size_bytes = $3,
                description = COALESCE($4, description),
                mem_type = COALESCE($5, mem_type),
                updated_at = NOW()
          WHERE id = $6
       RETURNING id, store_id, path, content, content_sha256, size_bytes, description, mem_type, created_at, updated_at`,
        [
          input.content,
          newSha,
          sizeBytes,
          input.description ?? null,
          input.memType ?? null,
          row.id,
        ],
      )
      await insertVersion(client, {
        storeId: input.storeId,
        memoryId: row.id,
        path: input.path,
        operation: 'update',
        content: input.content,
        contentSha256: newSha,
        sizeBytes,
        actorKind: input.actorKind,
        actorId: input.actorId,
      })
      await client.query('COMMIT')
      return updated.rows[0]
    }
    if (input.ifMatchSha256 !== undefined && input.ifMatchSha256 !== '') {
      // caller expected an existing row at a specific sha; nothing there.
      throw new PreconditionFailedError(null)
    }
    const id = generateId()
    const inserted = await client.query<MemoryRow>(
      `INSERT INTO memories (id, store_id, path, content, content_sha256, size_bytes, description, mem_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, store_id, path, content, content_sha256, size_bytes, description, mem_type, created_at, updated_at`,
      [
        id,
        input.storeId,
        input.path,
        input.content,
        newSha,
        sizeBytes,
        input.description ?? '',
        input.memType ?? null,
      ],
    )
    await insertVersion(client, {
      storeId: input.storeId,
      memoryId: id,
      path: input.path,
      operation: 'create',
      content: input.content,
      contentSha256: newSha,
      sizeBytes,
      actorKind: input.actorKind,
      actorId: input.actorId,
    })
    await client.query('COMMIT')
    return inserted.rows[0]
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export async function deleteMemoryByPath(input: {
  storeId: string
  path: string
  ifMatchSha256?: string
  actorKind: ActorKind
  actorId: string | null
}): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query<MemoryRow>(
      `SELECT id, content_sha256 FROM memories
        WHERE store_id = $1 AND path = $2 FOR UPDATE`,
      [input.storeId, input.path],
    )
    const row = existing.rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return false
    }
    if (
      input.ifMatchSha256 !== undefined &&
      input.ifMatchSha256 !== '' &&
      input.ifMatchSha256 !== row.content_sha256
    ) {
      throw new PreconditionFailedError(row.content_sha256)
    }
    await client.query('DELETE FROM memories WHERE id = $1', [row.id])
    await insertVersion(client, {
      storeId: input.storeId,
      memoryId: row.id,
      path: input.path,
      operation: 'delete',
      content: null,
      contentSha256: null,
      sizeBytes: null,
      actorKind: input.actorKind,
      actorId: input.actorId,
    })
    await client.query('COMMIT')
    return true
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/**
 * Move a memory from one path to another atomically, preserving its identity
 * (id, content, created_at) — the FUSE rename(2) backend.
 *
 * This is strictly better than the client emulating rename with PUT+DELETE:
 *   - atomic (single transaction; no torn "both paths" / "neither path" window)
 *   - keeps the row's id + created_at + version lineage instead of minting a
 *     fresh memory and orphaning the old history
 *
 * Concurrency / preconditions:
 *   - ifMatchSha256 set → the `from` row must currently match, else PreconditionFailedError
 *   - `to` already exists:
 *       overwrite=false → PathConflictError
 *       overwrite=true  → the `to` row is deleted (recorded as a delete version)
 *                         in the same transaction, then `from` is moved onto it.
 *         This is the editor "write temp → rename over target" atomic-save path.
 *
 * Returns null if no memory exists at `fromPath` (surfaces as 404 / ENOENT).
 */
export async function moveMemory(input: {
  storeId: string
  fromPath: string
  toPath: string
  overwrite: boolean
  ifMatchSha256?: string
  actorKind: ActorKind
  actorId: string | null
}): Promise<MemoryRow | null> {
  if (input.fromPath === input.toPath) {
    // No-op move; just return the current row (or null if absent).
    return getMemoryByPath(input.storeId, input.fromPath)
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Lock the two rows in a deterministic path order so two concurrent moves
    // that touch the same pair can't deadlock.
    const [lo, hi] = [input.fromPath, input.toPath].sort()
    const locked = await client.query<MemoryRow>(
      `SELECT id, store_id, path, content, content_sha256, size_bytes, description, mem_type, created_at, updated_at
         FROM memories WHERE store_id = $1 AND path = ANY($2) ORDER BY path FOR UPDATE`,
      [input.storeId, [lo, hi]],
    )
    const fromRow = locked.rows.find((r) => r.path === input.fromPath)
    const toRow = locked.rows.find((r) => r.path === input.toPath)
    if (!fromRow) {
      await client.query('ROLLBACK')
      return null
    }
    if (
      input.ifMatchSha256 !== undefined &&
      input.ifMatchSha256 !== '' &&
      input.ifMatchSha256 !== fromRow.content_sha256
    ) {
      throw new PreconditionFailedError(fromRow.content_sha256)
    }
    if (toRow) {
      if (!input.overwrite) throw new PathConflictError()
      await client.query('DELETE FROM memories WHERE id = $1', [toRow.id])
      await insertVersion(client, {
        storeId: input.storeId,
        memoryId: toRow.id,
        path: input.toPath,
        operation: 'delete',
        content: null,
        contentSha256: null,
        sizeBytes: null,
        actorKind: input.actorKind,
        actorId: input.actorId,
      })
    }
    const moved = await client.query<MemoryRow>(
      `UPDATE memories SET path = $1, updated_at = NOW()
        WHERE id = $2
    RETURNING id, store_id, path, content, content_sha256, size_bytes, description, mem_type, created_at, updated_at`,
      [input.toPath, fromRow.id],
    )
    // Record the rename at the new path; content is unchanged so we don't
    // duplicate the body, but we stamp the sha so the new path's history has
    // an anchor sha at move time.
    await insertVersion(client, {
      storeId: input.storeId,
      memoryId: fromRow.id,
      path: input.toPath,
      operation: 'rename',
      content: null,
      contentSha256: fromRow.content_sha256,
      sizeBytes: fromRow.size_bytes,
      actorKind: input.actorKind,
      actorId: input.actorId,
    })
    await client.query('COMMIT')
    return moved.rows[0]
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

// ── Versions ────────────────────────────────────────────────────────────────

async function insertVersion(
  client: { query: (text: string, params: unknown[]) => Promise<unknown> },
  v: {
    storeId: string
    memoryId: string | null
    path: string
    operation: VersionOp
    content: string | null
    contentSha256: string | null
    sizeBytes: number | null
    actorKind: ActorKind
    actorId: string | null
  },
): Promise<void> {
  await client.query(
    `INSERT INTO memory_versions
       (id, store_id, memory_id, path, operation, content, content_sha256, actor_kind, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      generateId(),
      v.storeId,
      v.memoryId,
      v.path,
      v.operation,
      v.content,
      v.contentSha256,
      v.actorKind,
      v.actorId,
    ],
  )
}

export async function listVersions(
  storeId: string,
  opts: { path?: string; limit?: number } = {},
): Promise<VersionRow[]> {
  const limit = Math.min(opts.limit ?? 100, 500)
  if (opts.path) {
    // Per-path: derive version_number via row_number() over chronological order
    // so the UI can show "v1, v2, v3..." with the latest write being the highest.
    const { rows } = await pool.query(
      `SELECT id, store_id, memory_id, path, operation, content_sha256,
              octet_length(content) AS size_bytes,
              actor_kind, actor_id, created_at, version_number
         FROM (
           SELECT *,
                  ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC)::int AS version_number
             FROM memory_versions
            WHERE store_id = $1 AND path = $2
         ) t
        ORDER BY created_at DESC
        LIMIT $3`,
      [storeId, opts.path, limit],
    )
    return rows
  }
  const { rows } = await pool.query(
    `SELECT id, store_id, memory_id, path, operation, content_sha256,
            octet_length(content) AS size_bytes,
            actor_kind, actor_id, created_at,
            NULL::int AS version_number
       FROM memory_versions WHERE store_id = $1
      ORDER BY created_at DESC LIMIT $2`,
    [storeId, limit],
  )
  return rows
}

interface VersionDetail extends VersionRow {
  content: string | null
  version_number: number
}

export async function getVersionById(
  storeId: string,
  versionId: string,
): Promise<VersionDetail | null> {
  const { rows } = await pool.query<VersionDetail>(
    `SELECT id, store_id, memory_id, path, operation, content, content_sha256,
            octet_length(content) AS size_bytes,
            actor_kind, actor_id, created_at,
            (SELECT COUNT(*)::int
               FROM memory_versions v2
              WHERE v2.store_id = v1.store_id
                AND v2.path = v1.path
                AND (v2.created_at, v2.id) <= (v1.created_at, v1.id)
            ) AS version_number
       FROM memory_versions v1
      WHERE v1.id = $1 AND v1.store_id = $2`,
    [versionId, storeId],
  )
  return rows[0] ?? null
}

/**
 * Apply a previous version's content as a new write at the same path.
 * Behaves like a normal update: takes the current memory's sha precondition,
 * records a new version row, no destructive history rewrite.
 *
 * If the path has been deleted, recreates the memory.
 */
export async function rollbackToVersion(input: {
  storeId: string
  versionId: string
  actorKind: ActorKind
  actorId: string | null
}): Promise<MemoryRow> {
  const target = await getVersionById(input.storeId, input.versionId)
  if (!target) throw new Error('version not found')
  if (target.operation === 'delete' || target.content === null) {
    throw new Error('cannot rollback to a delete operation')
  }
  const current = await getMemoryByPath(input.storeId, target.path)
  return putMemory({
    storeId: input.storeId,
    path: target.path,
    content: target.content,
    ifMatchSha256: current?.content_sha256 ?? '',
    actorKind: input.actorKind,
    actorId: input.actorId,
  })
}

// ── Workspace attachments ───────────────────────────────────────────────────

export async function listAttachmentsForWorkspace(workspaceId: string): Promise<AttachmentRow[]> {
  const { rows } = await pool.query(
    `SELECT a.workspace_id, a.store_id, s.name AS store_name,
            COALESCE(s.description, '') AS store_description,
            a.access, a.instructions, a.created_at
       FROM workspace_memory_attachments a
       JOIN memory_stores s ON s.id = a.store_id
      WHERE a.workspace_id = $1
      ORDER BY s.name`,
    [workspaceId],
  )
  return rows
}

interface StoreAttachmentRow {
  workspace_id: string
  workspace_name: string
  access: MemoryAccess
  instructions: string
  created_at: string
}

export async function listAttachmentsForStore(storeId: string): Promise<StoreAttachmentRow[]> {
  const { rows } = await pool.query(
    `SELECT a.workspace_id, w.name AS workspace_name,
            a.access, a.instructions, a.created_at
       FROM workspace_memory_attachments a
       JOIN workspaces w ON w.id = a.workspace_id
      WHERE a.store_id = $1
      ORDER BY w.name`,
    [storeId],
  )
  return rows
}

export async function countAttachmentsForWorkspace(workspaceId: string): Promise<number> {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM workspace_memory_attachments WHERE workspace_id = $1',
    [workspaceId],
  )
  return rows[0].n
}

export async function attachStore(input: {
  workspaceId: string
  storeId: string
  access?: MemoryAccess
  instructions?: string
}): Promise<AttachmentRow | null> {
  await pool.query(
    `INSERT INTO workspace_memory_attachments (workspace_id, store_id, access, instructions)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, store_id) DO UPDATE
       SET access = EXCLUDED.access, instructions = EXCLUDED.instructions`,
    [input.workspaceId, input.storeId, input.access ?? 'read_write', input.instructions ?? ''],
  )
  return getAttachment(input.workspaceId, input.storeId)
}

export async function patchAttachment(
  workspaceId: string,
  storeId: string,
  patch: { access?: MemoryAccess; instructions?: string },
): Promise<AttachmentRow | null> {
  const sets: string[] = []
  const params: unknown[] = []
  let i = 1
  if (patch.access !== undefined) {
    sets.push(`access = $${i++}`)
    params.push(patch.access)
  }
  if (patch.instructions !== undefined) {
    sets.push(`instructions = $${i++}`)
    params.push(patch.instructions)
  }
  if (sets.length === 0) return getAttachment(workspaceId, storeId)
  params.push(workspaceId, storeId)
  await pool.query(
    `UPDATE workspace_memory_attachments SET ${sets.join(', ')}
       WHERE workspace_id = $${i++} AND store_id = $${i}`,
    params,
  )
  return getAttachment(workspaceId, storeId)
}

export async function getAttachment(
  workspaceId: string,
  storeId: string,
): Promise<AttachmentRow | null> {
  const { rows } = await pool.query(
    `SELECT a.workspace_id, a.store_id, s.name AS store_name,
            COALESCE(s.description, '') AS store_description,
            a.access, a.instructions, a.created_at
       FROM workspace_memory_attachments a
       JOIN memory_stores s ON s.id = a.store_id
      WHERE a.workspace_id = $1 AND a.store_id = $2`,
    [workspaceId, storeId],
  )
  return rows[0] ?? null
}

export async function detachStore(workspaceId: string, storeId: string): Promise<boolean> {
  const r = await pool.query(
    'DELETE FROM workspace_memory_attachments WHERE workspace_id = $1 AND store_id = $2',
    [workspaceId, storeId],
  )
  return (r.rowCount ?? 0) > 0
}
