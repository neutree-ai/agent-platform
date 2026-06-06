import type { UsageSweepResponse } from '../../../../internal/agent-usage/src/index'
import { postToAgent } from '../../lib/workspace-address'
import { getUsageCursor, insertUsageRecords, setUsageCursor } from '../db/workspace-usage'
import { getWorkspace, listRunningWorkspaces } from '../db/workspaces'

/**
 * Token-usage puller. Pulls per-turn usage records from a workspace agent's
 * `POST /usage` endpoint (which reads the on-disk transcripts) and appends them
 * to the immutable ledger. Pull-based and idempotent: the agent holds no state,
 * the cursor + ledger live here, so a missed/failed pull only delays ingestion
 * — the next pull (or the first pull, which sweeps full history → backfill)
 * picks up everything, and UNIQUE(dedup_key) makes re-pulls safe.
 *
 * Two triggers feed the same idempotent path: an opportunistic pull on
 * `session.ended` (fresh data for the active workspace) and the periodic sweep
 * registered in the reconcile loop. For claude the final assistant message is
 * already settled at session.ended (the SDK appends last-prompt/ai-title rows
 * after it, so it is never the file's trailing entry) and gets picked up by the
 * per-turn pull; the sweep is the backstop for stopped→running backlog and any
 * turns whose pull failed.
 */

const PULL_TIMEOUT_MS = 30_000
const SWEEP_CONCURRENCY = 5
// Changed transcript files processed per agent round-trip. Bounds the agent's
// parse memory, the HTTP response size, and the single insert's row count.
const PULL_BATCH_FILES = 50
// Max batches drained in one pullWorkspaceUsage call. A huge backlog (e.g. a
// 1400-file pod on first pull) drains over several sweep ticks instead of
// hogging a concurrency slot; the leftover stays "changed" in the cursor and
// resumes next tick. Per call: up to 50 * 40 = 2000 files.
const MAX_BATCHES_PER_PULL = 40

/**
 * Pull one workspace's new usage into the ledger, draining in bounded batches
 * until the agent reports no more (or the per-call batch cap is hit; the rest
 * resumes on the next pull). Pass `userId` when known (the sweep already has it)
 * to skip a workspace lookup. Returns total rows inserted.
 */
export async function pullWorkspaceUsage(workspaceId: string, userId?: string): Promise<number> {
  let owner = userId
  if (!owner) {
    const ws = await getWorkspace(workspaceId)
    if (!ws) return 0
    owner = ws.user_id
  }

  let inserted = 0
  let pulled = 0
  for (let batch = 0; batch < MAX_BATCHES_PER_PULL; batch++) {
    const cursor = await getUsageCursor(workspaceId)
    const resp = await postToAgent(
      workspaceId,
      '/usage',
      { cursors: cursor, maxFiles: PULL_BATCH_FILES },
      PULL_TIMEOUT_MS,
    )
    if (!resp) {
      // Agent not reachable (stopped / starting / mid-restart) — pull again later.
      console.warn(`[usage] pull fetch failed ws=${workspaceId}`)
      break
    }
    if (!resp.ok) {
      console.warn(`[usage] pull non-ok ws=${workspaceId} status=${resp.status}`)
      break
    }

    const { records, cursors, hasMore } = (await resp.json()) as UsageSweepResponse
    inserted += await insertUsageRecords(workspaceId, owner, records)
    pulled += records.length
    // Persist the cursor after each batch so progress survives a later failure.
    await setUsageCursor(workspaceId, cursors)
    if (!hasMore) break
  }

  if (inserted > 0) {
    console.log(`[usage] ws=${workspaceId} +${inserted} records (pulled ${pulled})`)
  }
  return inserted
}

/** Sweep all running workspaces, pulling usage with bounded concurrency. */
export async function sweepRunningWorkspaces(): Promise<void> {
  const workspaces = await listRunningWorkspaces()
  let i = 0
  const worker = async () => {
    while (i < workspaces.length) {
      const w = workspaces[i++]
      await pullWorkspaceUsage(w.id, w.user_id).catch((e) =>
        console.warn(`[usage] sweep pull failed ws=${w.id}:`, e instanceof Error ? e.message : e),
      )
    }
  }
  await Promise.all(Array.from({ length: Math.min(SWEEP_CONCURRENCY, workspaces.length) }, worker))
}
