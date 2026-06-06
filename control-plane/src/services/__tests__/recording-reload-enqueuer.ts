/**
 * RecordingReloadEnqueuer — records `enqueue` calls so tests can assert
 * "a reload was enqueued for skill X" without a live pg-boss. The actual
 * per-workspace fanout is exercised against the cp `/_cp/skills/:id/reload-fanout`
 * route, not here.
 */
import type { ReloadEnqueuer } from '../agent-notifier'

export class RecordingReloadEnqueuer implements ReloadEnqueuer {
  calls: string[] = []

  async enqueue(skillId: string): Promise<void> {
    this.calls.push(skillId)
  }
}
