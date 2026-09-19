import type {
  ApiTransferPlan,
  ApiWorkspaceTransfer,
  TransferCopySelection,
  TransferStatus,
} from '../../../../internal/types/api'
import { generateId, pool } from './pool'

/** How long a pending transfer waits for the recipient. */
const TRANSFER_TTL_DAYS = 7

interface TransferOptions {
  copy?: TransferCopySelection
}

const SELECT_TRANSFER = `
  SELECT t.id, t.workspace_id, w.name AS workspace_name,
         json_build_object('id', fu.id, 'username', fu.username, 'display_name', fu.display_name) AS from_user,
         json_build_object('id', tu.id, 'username', tu.username, 'display_name', tu.display_name) AS to_user,
         t.initiated_by, t.status, t.options, t.error,
         t.created_at, t.expires_at, t.resolved_at
    FROM workspace_transfers t
    JOIN workspaces w ON w.id = t.workspace_id
    JOIN users fu ON fu.id = t.from_user_id
    JOIN users tu ON tu.id = t.to_user_id`

/**
 * A pending transfer past its deadline reads as expired. Expiry is applied on
 * read rather than by a sweeper: nothing acts on an expired transfer, so the
 * row only has to stop counting as open by the time someone looks at it.
 */
const EXPIRE_STALE = `
  UPDATE workspace_transfers
     SET status = 'expired', resolved_at = expires_at
   WHERE status = 'pending' AND expires_at < now()`

function toApi(r: any): ApiWorkspaceTransfer {
  const options = (r.options ?? {}) as TransferOptions
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    workspace_name: r.workspace_name,
    from_user: r.from_user,
    to_user: r.to_user,
    initiated_by: r.initiated_by,
    status: r.status,
    copy: options.copy ?? { prompts: [], skills: [] },
    error: r.error,
    created_at: new Date(r.created_at).toISOString(),
    expires_at: new Date(r.expires_at).toISOString(),
    resolved_at: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
  }
}

export async function getTransfer(id: string): Promise<ApiWorkspaceTransfer | null> {
  await pool.query(`${EXPIRE_STALE} AND id = $1`, [id])
  const { rows } = await pool.query(`${SELECT_TRANSFER} WHERE t.id = $1`, [id])
  return rows[0] ? toApi(rows[0]) : null
}

/** The workspace's open (pending or executing) transfer, if any. */
export async function getOpenTransferForWorkspace(
  workspaceId: string,
): Promise<ApiWorkspaceTransfer | null> {
  await pool.query(`${EXPIRE_STALE} AND workspace_id = $1`, [workspaceId])
  const { rows } = await pool.query(
    `${SELECT_TRANSFER} WHERE t.workspace_id = $1 AND t.status IN ('pending', 'executing')`,
    [workspaceId],
  )
  return rows[0] ? toApi(rows[0]) : null
}

/** Transfers waiting on this user to accept or decline. */
export async function listPendingTransfersTo(userId: string): Promise<ApiWorkspaceTransfer[]> {
  await pool.query(`${EXPIRE_STALE} AND to_user_id = $1`, [userId])
  const { rows } = await pool.query(
    `${SELECT_TRANSFER} WHERE t.to_user_id = $1 AND t.status = 'pending' ORDER BY t.created_at DESC`,
    [userId],
  )
  return rows.map(toApi)
}

/**
 * Open a transfer. Throws the unique-violation (23505) from
 * workspace_transfers_open_uniq when the workspace already has one open.
 */
export async function createTransfer(input: {
  workspaceId: string
  fromUserId: string
  toUserId: string
  initiatedBy: string
  copy: TransferCopySelection
  status: 'pending' | 'executing'
}): Promise<string> {
  const id = generateId()
  await pool.query(`${EXPIRE_STALE} AND workspace_id = $1`, [input.workspaceId])
  await pool.query(
    `INSERT INTO workspace_transfers
       (id, workspace_id, from_user_id, to_user_id, initiated_by, options, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(days => $8))`,
    [
      id,
      input.workspaceId,
      input.fromUserId,
      input.toUserId,
      input.initiatedBy,
      JSON.stringify({ copy: input.copy } satisfies TransferOptions),
      input.status,
      TRANSFER_TTL_DAYS,
    ],
  )
  return id
}

/**
 * Move a transfer between states, only if it is still in `from`. Returns
 * whether it moved — false means someone else resolved it first, which is how
 * an accept racing a cancel (or two accepts) is settled.
 */
export async function transitionTransfer(
  id: string,
  from: TransferStatus,
  to: TransferStatus,
  extra: { error?: string | null; manifest?: ApiTransferPlan } = {},
): Promise<boolean> {
  const resolved = to !== 'pending' && to !== 'executing'
  const { rowCount } = await pool.query(
    `UPDATE workspace_transfers
        SET status = $3,
            error = $4,
            manifest = COALESCE($5::jsonb, manifest),
            resolved_at = CASE WHEN $6 THEN now() ELSE NULL END
      WHERE id = $1 AND status = $2
        AND NOT (status = 'pending' AND expires_at < now())`,
    [
      id,
      from,
      to,
      extra.error ?? null,
      extra.manifest ? JSON.stringify(extra.manifest) : null,
      resolved,
    ],
  )
  return (rowCount ?? 0) > 0
}
