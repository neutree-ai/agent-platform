import type { ApiResourceSummary } from '../../../internal/types/api'
import type { WorkspaceFootprint } from './db/resource-usage'

/**
 * Turns a user's workspace inventory into the two reclaimable lists the
 * Resources app acts on. Both come from the same footprints because they are
 * the same fact seen twice: a workspace holds compute while it runs and holds
 * its volume until it is deleted.
 */
export function summarizeFootprints(
  footprints: WorkspaceFootprint[],
  idleCoreHours: Record<string, number>,
  { idleDays }: { idleDays: number },
): Pick<ApiResourceSummary, 'idle' | 'storage'> {
  // Auto-scaling workspaces are left out: the autoscaler already scales them to
  // zero on its own clock, so calling one idle would ask the user to fix
  // something the platform is handling.
  const idle = footprints
    .filter((w) => w.status === 'running' && !w.autoScaling && w.idleDays >= idleDays)
    .map((w) => ({
      workspaceId: w.workspaceId,
      name: w.name,
      idleDays: w.idleDays,
      coreRequest: w.coreRequest,
      // Measured, not projected from `idleDays`: a workspace can be idle for
      // longer than the meter has been watching, and a figure that outruns the
      // total it sits under is worse than a small one.
      coreHours: idleCoreHours[w.workspaceId] ?? 0,
    }))
    .sort((a, b) => b.coreHours - a.coreHours)

  const stopped = footprints
    .filter((w) => w.status !== 'running')
    .map((w) => ({
      workspaceId: w.workspaceId,
      name: w.name,
      storageGib: w.storageGib,
      idleDays: w.idleDays,
    }))
    .sort((a, b) => b.storageGib - a.storageGib)

  return {
    idle,
    storage: {
      // Every live workspace, running or not — the disk is allocated either way.
      totalGib: footprints.reduce((sum, w) => sum + w.storageGib, 0),
      stopped,
    },
  }
}
