import type { ApiWorkspace } from '../../../../internal/types/api'
import { getWorkspaceAddress } from '../../lib/workspace-address'
import { listActiveSessionIds } from '../../services/db/sessions'
import type { Workspace } from '../../services/db/types'
import { CURRENT_TEMPLATE_VERSION } from '../../services/k8s'

/** Check if user can manage (edit/delete/start/stop) a workspace */
export function canManage(workspace: Workspace, user: { sub: string; role: string }): boolean {
  return workspace.user_id === user.sub || (workspace.is_system && user.role === 'admin')
}

/**
 * `delivered`  — the interrupt request reached the agent and got a response.
 * `interrupted` — a running turn was actually aborted. The agent answers
 *   HTTP 200 even when it found no running turn to abort (e.g. the agent
 *   session is still starting up and is not yet registered), so this must
 *   come from the response body, not the status code.
 */
export async function interruptAgentSession(
  address: string,
  sessionId: string,
  tag: string,
): Promise<{ delivered: boolean; interrupted: boolean }> {
  try {
    console.log(`[${tag}] Interrupting session=${sessionId}`)
    const resp = await fetch(`${address}/sessions/${sessionId}/interrupt`, { method: 'POST' })
    if (!resp.ok) {
      console.warn(`[${tag}] Interrupt request failed session=${sessionId} status=${resp.status}`)
      return { delivered: false, interrupted: false }
    }
    const body = (await resp.json().catch(() => null)) as { interrupted?: boolean } | null
    const interrupted = body?.interrupted === true
    console.log(
      `[${tag}] Interrupt response session=${sessionId} status=${resp.status} interrupted=${interrupted}`,
    )
    return { delivered: true, interrupted }
  } catch (e) {
    console.error(`[${tag}] Failed to interrupt session:`, e)
    return { delivered: false, interrupted: false }
  }
}

export async function interruptAllSessions(workspace: Workspace, tag: string): Promise<void> {
  if (workspace.status !== 'running') return
  const address = getWorkspaceAddress(workspace.id)
  const sessionIds = await listActiveSessionIds(workspace.id)
  for (const sid of sessionIds) {
    await interruptAgentSession(address, sid, tag)
  }
}

export function toApiWorkspace(
  w: Workspace & {
    active_agent_sessions?: number
    active_human_sessions?: number
    active_sessions?: { id: string; chat_status: string; preview: string; name?: string }[]
  },
  owner: string,
  tagIds: string[] = [],
): ApiWorkspace {
  return {
    id: w.id,
    name: w.name,
    slug: w.slug,
    visibility: w.visibility,
    is_system: w.is_system ?? false,
    owner,
    status: w.status,
    created_at: w.created_at,
    tag_ids: tagIds,
    active_agent_sessions: w.active_agent_sessions ?? 0,
    active_human_sessions: w.active_human_sessions ?? 0,
    active_sessions: w.active_sessions ?? [],
    // A rebuild/update is available when the deployed runtime version is known
    // and behind the current platform template. Pure DB comparison — no k8s.
    rebuild_available: w.runtime_version != null && w.runtime_version < CURRENT_TEMPLATE_VERSION,
  }
}
