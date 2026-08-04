// workspace_tokens service — per-workspace credentials for the workload's own
// calls back into cp (agent server, memory-fuse / afs sidecars).
//
// Mirrors the mechanics of environment-tokens.ts (random secret returned once,
// SHA-256 at rest, Bearer → hash compare, revoked_at) but resolves to a
// narrower principal still: verify yields a workspace id, never a user and
// never an environment. Routes that carry an :id compare it against that
// principal, so a leaked token cannot read past its own workspace.
//
// The plaintext is never stored. It is handed to the runner once at placement
// and lives only in the workload's process environment; a token that is lost is
// re-minted, not recovered.

import {
  generateWorkspaceToken,
  hashWorkspaceToken,
  newWorkspaceTokenId,
} from '../../../../internal/types/workspace-token'
import { pool } from './pool'

interface CreatedWorkspaceToken {
  id: string
  /** Plaintext token — surfaced only here, never stored or returned again. */
  token: string
  created_at: string
}

/**
 * Mint a token for a workspace. Called once per placement, so several live
 * tokens per workspace are normal — a rolling update has the outgoing and
 * incoming pods holding different ones. {@link revokeSupersededWorkspaceTokens}
 * retires the extras.
 */
export async function createWorkspaceToken(workspaceId: string): Promise<CreatedWorkspaceToken> {
  const id = newWorkspaceTokenId()
  const token = generateWorkspaceToken()
  const { rows } = await pool.query(
    `INSERT INTO workspace_tokens (id, workspace_id, token_hash)
     VALUES ($1, $2, $3) RETURNING id, created_at`,
    [id, workspaceId, hashWorkspaceToken(token)],
  )
  return { id: rows[0].id, token, created_at: rows[0].created_at }
}

// last_used_at is an operational breadcrumb ("when did this workspace last talk
// to cp"), not an audit record, and the agent polls often enough that writing on
// every request would be a steady stream of pointless UPDATEs. The throttle is a
// predicate on the row rather than a map in memory: cp runs several replicas, so
// a per-process memo would let each of them write once per window anyway, and it
// would grow an entry for every token the process ever saw.
const LAST_USED_THROTTLE = '1 minute'

/**
 * Verify a raw Bearer token. Returns the workspace it was minted for and that
 * workspace's owner — the JOIN needs the row anyway, and every caller that
 * resolves a user would otherwise re-read it. Null when the token is unknown,
 * revoked, or orphaned by a deleted workspace.
 */
export async function verifyWorkspaceToken(
  raw: string,
): Promise<{ workspaceId: string; userId: string } | null> {
  if (!raw) return null
  const { rows } = await pool.query(
    `SELECT t.id, t.workspace_id, w.user_id
       FROM workspace_tokens t
       JOIN workspaces w ON w.id = t.workspace_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
    [hashWorkspaceToken(raw)],
  )
  if (!rows[0]) return null

  // Fire-and-forget: a failed breadcrumb must never fail the request it describes.
  pool
    .query(
      `UPDATE workspace_tokens SET last_used_at = NOW()
        WHERE id = $1
          AND (last_used_at IS NULL OR last_used_at < NOW() - interval '${LAST_USED_THROTTLE}')`,
      [rows[0].id],
    )
    .catch((e) => console.error('[workspace-tokens] last_used_at update failed:', e))

  return { workspaceId: rows[0].workspace_id, userId: rows[0].user_id }
}

/**
 * Revoke every token of a workspace. Called when the workspace stops — a
 * stopped workspace has nothing running that should still be able to reach cp.
 */
export async function revokeAllWorkspaceTokens(workspaceId: string): Promise<number> {
  const result = await pool.query(
    `UPDATE workspace_tokens SET revoked_at = NOW()
      WHERE workspace_id = $1 AND revoked_at IS NULL`,
    [workspaceId],
  )
  return result.rowCount ?? 0
}

/** How long a superseded token stays valid so a rolling update can overlap. */
const SUPERSEDED_GRACE_MS = 60 * 60 * 1000

/**
 * Retire tokens their workspace has outgrown, fleet-wide: per workspace keep the
 * newest `keep`, revoke any older one past the grace window.
 *
 * The grace exists because minting happens at placement while the pod holding
 * the previous token may still be draining — revoking on sight would cut off the
 * outgoing pod mid-flight.
 *
 * One set-based statement rather than a per-workspace call in a loop: this runs
 * on a timer against every workspace there is, and a query per workspace would
 * be a thousand round-trips to revoke a handful of rows.
 *
 * Returns the number revoked. Safe to call on every pass.
 */
export async function sweepSupersededWorkspaceTokens(
  keep = 2,
  graceMs = SUPERSEDED_GRACE_MS,
): Promise<number> {
  const result = await pool.query(
    `UPDATE workspace_tokens SET revoked_at = NOW()
      WHERE id IN (
        SELECT id FROM (
          SELECT id, created_at,
                 row_number() OVER (PARTITION BY workspace_id ORDER BY created_at DESC) AS rn
            FROM workspace_tokens
           WHERE revoked_at IS NULL
        ) ranked
        WHERE ranked.rn > $1
          AND ranked.created_at < NOW() - make_interval(secs => $2)
      )`,
    [keep, graceMs / 1000],
  )
  return result.rowCount ?? 0
}
