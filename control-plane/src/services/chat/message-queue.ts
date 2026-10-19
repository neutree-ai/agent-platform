import { randomUUID } from 'node:crypto'
import { isDraining } from '../../lib/sse'
import {
  claimQueuedMessage,
  finishQueuedMessage,
  listQueuedSessions,
  renewQueuedMessage,
} from '../db/session-message-queue'
import type { Workspace } from '../db/types'
import { getWorkspace } from '../db/workspaces'

type StartTurn = (opts: {
  workspace: Workspace
  sessionId: string
  message: string
  images: { data: string; media_type: string }[]
  source: string
  callerUserId: string
}) => Promise<Response>

/** The delivery lease preserves FIFO across replicas; executeChat owns the session claim. */
export async function drainSessionMessageQueue(
  workspaceId: string,
  sessionId: string,
  startTurn: StartTurn,
): Promise<void> {
  if (isDraining()) return
  const token = randomUUID()
  const entry = await claimQueuedMessage(sessionId, token)
  if (!entry) return
  const renew = setInterval(() => {
    void renewQueuedMessage(entry.id, token).catch((e) =>
      console.error(`[message-queue] lease renewal failed id=${entry.id}:`, e),
    )
  }, 20_000)
  renew.unref()
  let delivered = false
  try {
    const workspace = await getWorkspace(workspaceId)
    if (!workspace) return
    const response = await startTurn({ workspace, sessionId, ...entry.payload })
    delivered = response.ok && !!response.headers.get('Content-Type')?.includes('text/event-stream')
    // Cancels the unused client buffer, not the persisted agent turn.
    void response.body?.cancel().catch(() => {})
    if (!delivered && response.status !== 409) {
      console.warn(`[message-queue] dispatch deferred id=${entry.id} status=${response.status}`)
    }
  } catch (e) {
    console.error(`[message-queue] dispatch failed id=${entry.id}:`, e)
  } finally {
    clearInterval(renew)
    await finishQueuedMessage(entry.id, token, delivered)
  }
}

/** Covers enqueue-vs-turn-end races, transient failures and CP restarts. */
export function startSessionMessageQueue(startTurn: StartTurn): void {
  let running = false
  const sweep = async () => {
    if (running || isDraining()) return
    running = true
    try {
      const sessions = await listQueuedSessions()
      // A cold workspace must not delay unrelated sessions' deliveries.
      for (let offset = 0; offset < sessions.length; offset += 8) {
        await Promise.all(
          sessions
            .slice(offset, offset + 8)
            .map((session) =>
              drainSessionMessageQueue(session.workspace_id, session.id, startTurn),
            ),
        )
      }
    } catch (e) {
      console.error('[message-queue] sweep failed:', e)
    } finally {
      running = false
    }
  }
  void sweep()
  setInterval(() => void sweep(), 5_000).unref()
}
