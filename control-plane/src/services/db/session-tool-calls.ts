import { pool } from './pool'

/**
 * Tool-call telemetry for one session, read off `session_events`.
 *
 * Deliberately two queries rather than one join on `call_id`: a `tool_result`
 * payload carries the tool's entire output, so a query that reads it for every
 * row spends its time detoasting megabytes it will throw away. Reading the
 * call rows and the error ids separately, then matching them in memory, is an
 * order of magnitude cheaper than either the join or a single combined scan.
 *
 * Calls come back in the order they happened — the activity strip buckets by
 * sequence, so the order is data rather than presentation.
 */

export interface ToolCallRow {
  callId: string | null
  name: string | null
  startedMs: number | null
  completedMs: number | null
}

export interface SessionToolCalls {
  calls: ToolCallRow[]
  /** Ids of the calls whose result came back an error. */
  errorCallIds: string[]
}

export async function listSessionToolCalls(sessionId: string): Promise<SessionToolCalls> {
  const [callRes, errorRes] = await Promise.all([
    pool.query(
      `SELECT call_id,
              payload->>'name' AS name,
              (payload->>'started_at')::bigint AS started_ms,
              (payload->>'completed_at')::bigint AS completed_ms
         FROM session_events
        WHERE session_id = $1 AND kind = 'tool_call'
        ORDER BY created_at`,
      [sessionId],
    ),
    pool.query(
      `SELECT call_id
         FROM session_events
        WHERE session_id = $1 AND kind = 'tool_result'
          AND (payload->>'is_error')::boolean`,
      [sessionId],
    ),
  ])

  return {
    calls: callRes.rows.map((r: Record<string, unknown>) => ({
      callId: (r.call_id as string) ?? null,
      name: (r.name as string) ?? null,
      startedMs: r.started_ms === null ? null : Number(r.started_ms),
      completedMs: r.completed_ms === null ? null : Number(r.completed_ms),
    })),
    errorCallIds: errorRes.rows
      .map((r: { call_id: string | null }) => r.call_id)
      .filter((id: string | null): id is string => id !== null),
  }
}
