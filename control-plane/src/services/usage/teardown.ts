import { DEFAULT_SETTLE_GRACE_MS } from '../../../../internal/agent-usage/src/index'
import { pullWorkspaceUsage } from './pull'

/**
 * Collecting a workspace's outstanding usage before its pod goes away.
 *
 * Usage lives on the transcripts until a pull moves it into the ledger, and the
 * only thing that pulls is a running pod. Deleting a workspace takes its volume
 * with it, so anything not yet collected is gone for good — and a caller that
 * recycles a workspace after each run is exactly the one that would lose it.
 *
 * The wait is what makes the collection whole rather than nearly whole. The
 * parser withholds a transcript's trailing entry until the file has been
 * quiescent for the settle grace, so a pull fired the instant a turn is
 * interrupted misses the last record it was written for. Waiting is also the
 * only safe way to get it: reading early could ingest a half-written streaming
 * record, and since it carries the same dedup key as the finished one, the
 * finished one would then be rejected as a duplicate — undercounting silently,
 * which is worse than being late.
 */

/** Slack on top of the grace, so the parser's comparison is not a photo finish. */
const SETTLE_MARGIN_MS = 1_000

/** Wait until transcripts last written around `since` count as quiescent. */
async function awaitQuiescent(since: number): Promise<void> {
  const remaining = since + DEFAULT_SETTLE_GRACE_MS + SETTLE_MARGIN_MS - Date.now()
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining))
}

/** Thrown when a teardown cannot account for what the workspace spent. */
export class UsageNotDrained extends Error {
  constructor(
    readonly workspaceId: string,
    readonly stop: string,
  ) {
    super(
      `Could not collect usage for workspace ${workspaceId} before deleting it (${stop}). Its unread records would be destroyed with the volume. Retry, or pass force=true to delete anyway.`,
    )
    this.name = 'UsageNotDrained'
  }
}

/**
 * Collect on the way to a stop. Detached from the caller and best-effort: the
 * volume survives a stop, so whatever this misses is still there to collect
 * after the next start. It runs at all so that a workspace stopped right after
 * a run still settles its account instead of leaving it open until then.
 *
 * Racing the scale-down is fine. The runner takes a reconcile tick to act on
 * desired=stopped, which is usually room enough, and losing the race costs
 * nothing that the next start will not recover.
 */
export function drainAfterStop(workspaceId: string, userId: string, settleFrom: number): void {
  void awaitQuiescent(settleFrom)
    .then(() => pullWorkspaceUsage(workspaceId, userId))
    .then((o) => {
      if (!o.drained) console.warn(`[usage] stop drain incomplete ws=${workspaceId} (${o.stop})`)
    })
    .catch((e) =>
      console.warn(`[usage] stop drain ws=${workspaceId}:`, e instanceof Error ? e.message : e),
    )
}

/**
 * Collect before a delete, blocking until it is done.
 *
 * Throws `UsageNotDrained` if the workspace is running and cannot be read,
 * because that is a transient failure worth retrying rather than a reason to
 * destroy the records. `force` is the way out for a workspace whose agent is
 * wedged — a workspace must never become undeletable.
 *
 * A workspace that is not running is not blocked on: nothing can read its
 * transcripts, so refusing would only mean "start it before you may delete it".
 * The loss is logged instead, since that is all that can honestly be done.
 */
export async function drainBeforeDelete(
  workspace: { id: string; user_id: string; status: string },
  settleFrom: number,
  force: boolean,
): Promise<void> {
  if (workspace.status !== 'running') {
    console.warn(
      `[usage] deleting a ${workspace.status} workspace ws=${workspace.id} — any records not yet collected go with its volume`,
    )
    return
  }

  await awaitQuiescent(settleFrom)
  const outcome = await pullWorkspaceUsage(workspace.id, workspace.user_id)
  if (outcome.drained) return

  if (!force) throw new UsageNotDrained(workspace.id, outcome.stop)
  console.warn(
    `[usage] forced delete ws=${workspace.id} with usage undrained (${outcome.stop}) — records not yet collected are lost`,
  )
}
