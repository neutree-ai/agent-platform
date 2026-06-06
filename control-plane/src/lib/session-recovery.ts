import { drainPendingMessage } from '../services/chat/executeChat'
import { getLastMessageWithBlocks } from '../services/db/messages'
import { pool } from '../services/db/pool'
import { transitionSessionStatus } from '../services/db/sessions'
import { getWorkspace } from '../services/db/workspaces'
import { activeStreams, createInterceptedSSEResponse, streamKey } from './sse'
import { getWorkspaceAddress } from './workspace-address'

/**
 * Recover orphaned sessions that are stuck in chat_status='agent' after a CP restart.
 *
 * For each orphaned session, attempts to reconnect to the agent's buffered SSE stream.
 * If the agent still has the session (turn in progress or completed with buffered events),
 * the stream is intercepted and persisted as usual.
 * If the agent has no record of the session (404), the session is marked idle.
 */
export async function recoverOrphanedSessions() {
  const { rows } = await pool.query<{ id: string; workspace_id: string }>(
    "SELECT id, workspace_id FROM sessions WHERE status = 'active' AND chat_status = 'agent'",
  )

  if (rows.length === 0) return

  console.log(`[Recovery] Found ${rows.length} orphaned agent session(s), attempting reconnect`)

  for (const { id: sessionId, workspace_id: workspaceId } of rows) {
    // Skip if there's already an active stream (shouldn't happen at startup)
    if (activeStreams.has(streamKey(workspaceId, sessionId))) {
      continue
    }

    try {
      const workspace = await getWorkspace(workspaceId)
      if (!workspace || workspace.status !== 'running') {
        await transitionSessionStatus(sessionId, 'idle')
        console.log(
          `[Recovery] workspace=${workspaceId} session=${sessionId} → idle (workspace not running)`,
        )
        continue
      }

      const address = getWorkspaceAddress(workspaceId)
      // The timeout applies to the *connection*, not the subsequent SSE
      // stream. `fetch`'s signal stays attached to the response body, so
      // if we passed `AbortSignal.timeout(10_000)` directly the body
      // would be aborted 10s into the stream — which is exactly what a
      // reconnect is *not* supposed to do. Clear the timer once we've
      // received headers so the body can stream indefinitely.
      const connectCtrl = new AbortController()
      const connectTimer = setTimeout(
        () => connectCtrl.abort(new Error('reconnect connection timeout')),
        10_000,
      )
      let response: Response
      try {
        response = await fetch(`${address}/sessions/${sessionId}/reconnect`, {
          method: 'POST',
          signal: connectCtrl.signal,
        })
      } finally {
        clearTimeout(connectTimer)
      }

      if (!response.ok || !response.headers.get('Content-Type')?.includes('text/event-stream')) {
        // Agent has no record of this turn — it finished before CP came back.
        // If the user had queued a follow-up, dispatch it as a fresh turn
        // now; otherwise the session settles to idle.
        const drained = await drainPendingMessage(workspaceId, sessionId)
        if (drained) {
          console.log(
            `[Recovery] workspace=${workspaceId} session=${sessionId} → drained pending message into a new turn`,
          )
          continue
        }
        await transitionSessionStatus(sessionId, 'idle')
        console.log(
          `[Recovery] workspace=${workspaceId} session=${sessionId} → idle (agent returned ${response.status})`,
        )
        continue
      }

      // If the last message in the session is an in-progress assistant
      // message (the row persisted before CP died), seed the persist
      // plugin so replayed events append to it instead of creating a
      // duplicate. If the last message is the user's prompt (CP died
      // before the assistant row was inserted), leave initialAssistant
      // undefined — the plugin will addMessage on its first persist.
      let initialAssistant: { id: string; content: string; blocks: any[] } | undefined
      try {
        const last = await getLastMessageWithBlocks(sessionId)
        if (last && last.role === 'assistant') {
          initialAssistant = {
            id: last.id,
            content: last.content ?? '',
            blocks: last.blocks,
          }
          console.log(
            `[Recovery] workspace=${workspaceId} session=${sessionId} resuming assistant message=${last.id} blocks=${initialAssistant.blocks.length}`,
          )
        }
      } catch (e) {
        console.warn(
          `[Recovery] workspace=${workspaceId} session=${sessionId} failed to load existing assistant message:`,
          e,
        )
      }

      // Agent has buffered events — intercept the SSE stream to persist them
      console.log(
        `[Recovery] workspace=${workspaceId} session=${sessionId} reconnecting to agent stream`,
      )
      createInterceptedSSEResponse(
        response,
        workspaceId,
        null,
        sessionId,
        undefined,
        undefined,
        'recovery',
        undefined,
        initialAssistant,
      )
    } catch (e: any) {
      console.error(`[Recovery] workspace=${workspaceId} session=${sessionId} error:`, e.message)
      await transitionSessionStatus(sessionId, 'idle')
    }
  }
}
