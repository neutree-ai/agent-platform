import { getWorkspaceAddress } from '../lib/workspace-address'
import type { Workspace } from './db/types'
import { getWorkspaceConfig } from './db/workspaces'
import { startWorkspaceInstance } from './workspace-reconcile'

/** Total budget for a stopped workspace to scale up and pass /health. */
const READY_TIMEOUT_MS = 90_000
/** Gap between consecutive /health polls. */
const POLL_INTERVAL_MS = 1_000
/** Per-attempt timeout for a single /health probe. */
const HEALTH_TIMEOUT_MS = 2_000

/** Thrown when a stopped workspace cannot be brought up to serve a chat turn. */
export class WorkspaceStartError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceStartError'
  }
}

// Collapse concurrent auto-starts of the same workspace into a single scale +
// readiness-poll. A connector blasting many events at a stopped workspace
// would otherwise issue N scale patches and N poll loops. cp is single-replica
// / single-process, so an in-process map is sufficient.
const inflight = new Map<string, Promise<void>>()

async function pollHealth(workspaceId: string): Promise<void> {
  const url = `${getWorkspaceAddress(workspaceId)}/health`
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
      if (resp.ok) return
    } catch {
      // Pod not reachable yet — no Service endpoint, connection refused, or
      // the agent HTTP server still booting. Keep polling until the deadline.
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new WorkspaceStartError(`Workspace did not become ready within ${READY_TIMEOUT_MS / 1000}s`)
}

async function runStart(workspaceId: string, needsScale: boolean): Promise<void> {
  if (needsScale) {
    const config = await getWorkspaceConfig(workspaceId)
    if (config?.auto_start === false) {
      throw new WorkspaceStartError('Workspace is stopped and auto-start is disabled')
    }
    await startWorkspaceInstance(workspaceId)
  }
  // When the scale was already triggered elsewhere (start route, rebuild, or a
  // prior auto-start), just wait for readiness.
  await pollHealth(workspaceId)
}

/**
 * Ensure a workspace instance is running and ready to serve a chat turn.
 *
 *   - running  → returns immediately
 *   - starting → waits for the agent /health to pass
 *   - stopped  → starts it (unless auto_start is disabled) then waits
 *   - error / anything else → throws; auto-start deliberately does not touch
 *     the error state, recovery is handled by the reconcile loop
 *
 * Concurrent calls for the same workspace share one start + poll. Throws a
 * `WorkspaceStartError` on any non-running outcome.
 */
export async function ensureWorkspaceRunning(workspace: Workspace): Promise<void> {
  if (workspace.status === 'running') return
  if (workspace.status !== 'stopped' && workspace.status !== 'starting') {
    // 'error' or any unexpected status — fail fast, do not attempt a start.
    throw new WorkspaceStartError(
      `Workspace is in "${workspace.status}" state and cannot be auto-started`,
    )
  }

  let task = inflight.get(workspace.id)
  if (!task) {
    task = runStart(workspace.id, workspace.status === 'stopped').finally(() => {
      inflight.delete(workspace.id)
    })
    inflight.set(workspace.id, task)
  }
  await task
}
