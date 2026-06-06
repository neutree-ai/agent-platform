import { resetAllSessionsIdle } from './db/sessions'
import { getWorkspace, listIdleRunningWorkspaces, updateWorkspace } from './db/workspaces'
import * as k8s from './k8s'

const DAY_MS = 86_400_000

/**
 * One pass of the idle-workspace GC: find running workspaces with no activity
 * for `idleDays` days and scale them down to reclaim CPU/memory.
 *
 * Reversible — a stopped workspace auto-starts again on the next chat or
 * trigger (see `ensureWorkspaceRunning`), so the only cost is a one-time cold
 * start. That fallback is the prerequisite for running this GC at all.
 *
 * Every run emits an audit trail: the candidate count, each workspace stopped
 * with its idle evidence (last_used, idle days), skips, failures, and a final
 * tally — so a wrongly-stopped workspace can always be traced back.
 */
export async function runIdleWorkspaceGC(idleDays: number): Promise<void> {
  let candidates: Awaited<ReturnType<typeof listIdleRunningWorkspaces>>
  try {
    candidates = await listIdleRunningWorkspaces(idleDays)
  } catch (e) {
    console.error('[IdleGC] failed to list idle workspaces:', e)
    return
  }

  if (candidates.length === 0) {
    console.log(`[IdleGC] run complete — no running workspace idle >= ${idleDays}d`)
    return
  }

  console.log(`[IdleGC] ${candidates.length} workspace(s) idle >= ${idleDays}d — stopping`)
  let stopped = 0
  let skipped = 0
  let failed = 0

  for (const ws of candidates) {
    const idleDaysActual = Math.floor((Date.now() - new Date(ws.last_used).getTime()) / DAY_MS)
    try {
      // The candidate list is a snapshot — re-check status, since the workspace
      // may have been started (manually or by auto-start) since the query ran.
      const current = await getWorkspace(ws.id)
      if (!current || current.status !== 'running') {
        skipped++
        console.log(
          `[IdleGC] skip workspace=${ws.id} name="${ws.name}" — status now ${current?.status ?? 'gone'}`,
        )
        continue
      }
      await k8s.stopInstance(ws.id)
      await resetAllSessionsIdle(ws.id)
      await updateWorkspace(ws.id, { status: 'stopped' })
      stopped++
      console.log(
        `[IdleGC] stopped workspace=${ws.id} name="${ws.name}" idle=${idleDaysActual}d last_used=${ws.last_used}`,
      )
    } catch (e) {
      failed++
      console.error(`[IdleGC] failed to stop workspace=${ws.id} name="${ws.name}":`, e)
    }
  }

  console.log(
    `[IdleGC] run complete — stopped=${stopped} skipped=${skipped} failed=${failed} of ${candidates.length} candidate(s)`,
  )
}
