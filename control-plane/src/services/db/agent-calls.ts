import { generateId, pool } from './pool'

// Calls one agent session (the parent) made to another (the child) through
// `call_agent`, and what became of each result on its way back. See
// migrations/148_agent_calls.sql for the column semantics.

type AgentCallStatus = 'running' | 'ended' | 'failed'

export interface AgentCall {
  id: string
  parent_session_id: string
  parent_workspace_id: string
  child_session_id: string
  child_workspace_id: string
  caller_user_id: string | null
  status: AgentCallStatus
  error: string | null
  delivery: 'pending' | 'delivered' | 'consumed' | 'dropped'
  delivery_note: string | null
  delivery_attempts: number
  input_requested_at: string | null
  input_notified_at: string | null
  created_at: string
  ended_at: string | null
}

/**
 * A call the parent is still waiting on: its result has not reached the parent
 * yet. A child parked on a question to its user is left out — that call moves
 * again only when a person answers, so the parent is not waiting on an agent.
 */
function openCallSql(alias: string): string {
  return `${alias}.delivery = 'pending'
    AND NOT (${alias}.status = 'running' AND ${alias}.input_requested_at IS NOT NULL)`
}

/** A pending call with something to tell the parent now. */
function deliverableSql(alias: string): string {
  return `${alias}.delivery = 'pending'
    AND (${alias}.delivery_lease_expires_at IS NULL OR ${alias}.delivery_lease_expires_at <= now())
    AND (
      ${alias}.status <> 'running'
      OR (${alias}.input_requested_at IS NOT NULL AND ${alias}.input_notified_at IS NULL)
    )`
}

/**
 * Correlated subquery counting a session's open calls, for session listings.
 * `sessionIdExpr` is the outer query's session id column.
 */
export function openAgentCallCountSql(sessionIdExpr: string): string {
  return `(SELECT COUNT(*)::int FROM agent_calls ac
            WHERE ac.parent_session_id = ${sessionIdExpr} AND ${openCallSql('ac')})`
}

export async function insertAgentCall(call: {
  parentSessionId: string
  parentWorkspaceId: string
  childSessionId: string
  childWorkspaceId: string
  callerUserId: string | null
}): Promise<void> {
  await pool.query(
    `INSERT INTO agent_calls
       (id, parent_session_id, parent_workspace_id, child_session_id, child_workspace_id, caller_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      generateId(),
      call.parentSessionId,
      call.parentWorkspaceId,
      call.childSessionId,
      call.childWorkspaceId,
      call.callerUserId,
    ],
  )
}

export async function countOpenAgentCalls(parentSessionId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM agent_calls c
      WHERE c.parent_session_id = $1 AND ${openCallSql('c')}`,
    [parentSessionId],
  )
  return rows[0]?.n ?? 0
}

/** Whether a tracked call is running in this session as the child. */
export async function hasRunningCallAsChild(childSessionId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM agent_calls WHERE child_session_id = $1 AND status = 'running' LIMIT 1`,
    [childSessionId],
  )
  return !!rowCount
}

/** The most recent call this parent made into this child session. */
export async function getLatestAgentCall(
  childSessionId: string,
  parentSessionId: string,
): Promise<AgentCall | null> {
  const { rows } = await pool.query(
    `SELECT * FROM agent_calls
      WHERE child_session_id = $1 AND parent_session_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [childSessionId, parentSessionId],
  )
  return (rows[0] as AgentCall) ?? null
}

/**
 * Record the outcome of the child's turn. Returns the calls it closed — none
 * when the session has no running call, which makes a repeat a no-op.
 */
export async function endAgentCalls(
  childSessionId: string,
  status: 'ended' | 'failed',
  error: string | null,
): Promise<AgentCall[]> {
  const { rows } = await pool.query(
    `UPDATE agent_calls
        SET status = $2, error = $3, ended_at = now()
      WHERE child_session_id = $1 AND status = 'running'
      RETURNING *`,
    [childSessionId, status, error],
  )
  return rows as AgentCall[]
}

/** Note that the child's turn is parked on a question to its user. */
export async function markAgentCallInputRequested(childSessionId: string): Promise<AgentCall[]> {
  const { rows } = await pool.query(
    `UPDATE agent_calls
        SET input_requested_at = now()
      WHERE child_session_id = $1 AND status = 'running' AND input_requested_at IS NULL
      RETURNING *`,
    [childSessionId],
  )
  return rows as AgentCall[]
}

/**
 * The parent read a finished result itself, so it must not be posted again.
 * False when there was no finished, still-pending result to take.
 */
export async function consumeAgentCall(
  childSessionId: string,
  parentSessionId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE agent_calls
        SET delivery = 'consumed', delivery_lease_expires_at = NULL
      WHERE child_session_id = $1 AND parent_session_id = $2
        AND delivery = 'pending' AND status <> 'running'`,
    [childSessionId, parentSessionId],
  )
  return !!rowCount
}

/**
 * Lease every result ready for this parent. Each row is a single UPDATE target,
 * so two replicas racing for the same parent split the rows between them and
 * neither posts a result the other holds.
 */
export async function takeDeliverableAgentCalls(
  parentSessionId: string,
  leaseSeconds: number,
): Promise<AgentCall[]> {
  const { rows } = await pool.query(
    `UPDATE agent_calls c
        SET delivery_lease_expires_at = now() + make_interval(secs => $2)
      WHERE c.parent_session_id = $1 AND ${deliverableSql('c')}
      RETURNING c.*`,
    [parentSessionId, leaseSeconds],
  )
  return (rows as AgentCall[]).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
}

/** Give leased results back untouched, to be taken again at the next chance. */
export async function releaseAgentCallDelivery(ids: string[]): Promise<void> {
  await pool.query(
    `UPDATE agent_calls SET delivery_lease_expires_at = NULL
      WHERE id = ANY($1) AND delivery = 'pending'`,
    [ids],
  )
}

/**
 * A delivery attempt failed. The lease is left to run out, which spaces the
 * retries; a result that has failed `maxAttempts` times is dropped.
 */
export async function failAgentCallDelivery(
  ids: string[],
  maxAttempts: number,
  note: string,
): Promise<void> {
  await pool.query(
    `UPDATE agent_calls
        SET delivery_attempts = delivery_attempts + 1,
            delivery_note = $3,
            delivery = CASE WHEN delivery_attempts + 1 >= $2 THEN 'dropped' ELSE delivery END
      WHERE id = ANY($1) AND delivery = 'pending'`,
    [ids, maxAttempts, note],
  )
}

/**
 * The leased results were posted to the parent. Finished calls are closed; a
 * call that only reported a question stays open for its eventual result. All
 * rows of one post share a `delivered_at`, which is what
 * `countAgentCallDeliveries` counts.
 */
export async function markAgentCallsDelivered(ids: string[]): Promise<void> {
  await pool.query(
    `UPDATE agent_calls
        SET delivery_lease_expires_at = NULL,
            input_notified_at = CASE WHEN status = 'running' THEN now() ELSE input_notified_at END,
            delivery = CASE WHEN status = 'running' THEN delivery ELSE 'delivered' END,
            delivered_at = CASE WHEN status = 'running' THEN delivered_at ELSE now() END
      WHERE id = ANY($1) AND delivery = 'pending'`,
    [ids],
  )
}

export async function dropAgentCallDelivery(ids: string[], note: string): Promise<void> {
  await pool.query(
    `UPDATE agent_calls
        SET delivery = 'dropped', delivery_note = $2, delivery_lease_expires_at = NULL
      WHERE id = ANY($1) AND delivery = 'pending'`,
    [ids, note],
  )
}

/** How many turns have been started in this session to deliver results. */
export async function countAgentCallDeliveries(parentSessionId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT COUNT(DISTINCT delivered_at)::int AS n FROM agent_calls
      WHERE parent_session_id = $1 AND delivery = 'delivered'`,
    [parentSessionId],
  )
  return rows[0]?.n ?? 0
}

/** Parent sessions with a result ready to post. */
export async function listParentsWithDeliverableCalls(limit: number): Promise<string[]> {
  const { rows } = await pool.query<{ parent_session_id: string }>(
    `SELECT DISTINCT c.parent_session_id FROM agent_calls c
      WHERE ${deliverableSql('c')}
      LIMIT $1`,
    [limit],
  )
  return rows.map((r) => r.parent_session_id)
}

/**
 * Running calls whose child session is no longer running a turn and is not
 * waiting on calls of its own — the turn ended without its outcome being
 * recorded (the replica running it went away). `session_gone` is true when the
 * child session itself was deleted.
 */
export async function listStaleRunningAgentCalls(
  graceSeconds: number,
  limit: number,
): Promise<{ child_session_id: string; session_gone: boolean }[]> {
  const { rows } = await pool.query<{ child_session_id: string; session_gone: boolean }>(
    `SELECT DISTINCT c.child_session_id, (s.id IS NULL) AS session_gone
       FROM agent_calls c
       LEFT JOIN sessions s ON s.id = c.child_session_id
      WHERE c.status = 'running'
        AND c.created_at < now() - make_interval(secs => $1)
        AND (
          s.id IS NULL
          OR (
            s.chat_status <> 'agent'
            AND (s.turn_claim IS NULL OR s.turn_claim_expires_at <= now())
            AND NOT EXISTS (
              SELECT 1 FROM agent_calls o
               WHERE o.parent_session_id = c.child_session_id AND ${openCallSql('o')}
            )
          )
        )
      LIMIT $2`,
    [graceSeconds, limit],
  )
  return rows
}
