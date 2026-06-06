/**
 * RecordingAgentNotifier — records `reload` calls so tests can assert
 * "workspace X was notified" without spinning up an HTTP server.
 *
 * Default behavior: ack everything (returns true). Tests can flip
 * `nextResult` to simulate the agent being unreachable.
 */
import type { AgentNotifier, ReloadScope } from '../agent-notifier'

interface RecordedReload {
  workspaceId: string
  scope: ReloadScope[]
}

export class RecordingAgentNotifier implements AgentNotifier {
  calls: RecordedReload[] = []
  nextResult: boolean | Error = true

  async reload(workspaceId: string, scope: ReloadScope[]): Promise<boolean> {
    this.calls.push({ workspaceId, scope })
    if (this.nextResult instanceof Error) throw this.nextResult
    return this.nextResult
  }
}
