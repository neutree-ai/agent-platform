/**
 * AgentNotifier port — outbound RPC to a workspace's agent telling it to
 * reload one of its config scopes. Pulled into a port so SkillsService
 * unit tests can assert "notified for these workspaces" without HTTP.
 *
 * Other CP routes (credentials / providers / memory-stores / templates) keep
 * calling `lib/workspace-address.ts#notifyAgentReload` directly for now —
 * porting the rest of CP is out of scope for the skills phase 0.
 */
import { notifyAgentReload } from '../lib/workspace-address'

export type ReloadScope = 'config' | 'skills' | 'credentials'

export interface AgentNotifier {
  /**
   * Notify a running agent to reload the given scopes. Returns true if the
   * agent acknowledged, false on any failure (network, non-2xx, timeout) —
   * never throws. Callers treat the result as advisory: the persistent
   * write has already succeeded by the time we ask the agent to refresh.
   */
  reload(workspaceId: string, scope: ReloadScope[]): Promise<boolean>
}

export class HttpAgentNotifier implements AgentNotifier {
  reload(workspaceId: string, scope: ReloadScope[]): Promise<boolean> {
    return notifyAgentReload(workspaceId, scope)
  }
}

/**
 * ReloadEnqueuer port — defers a skill's reload fanout to the background queue
 * instead of fanning out inline. SkillsService write paths call this and
 * return immediately; the scheduler worker performs the actual per-workspace
 * fanout. Ported so unit tests can assert "enqueued reload for skill X"
 * without a live pg-boss.
 */
export interface ReloadEnqueuer {
  enqueue(skillId: string): Promise<void>
}
