// Team changes that reach beyond the team's own rows. A folder granted to a
// team is mounted in its members' workspaces, so a member leaving, or the team
// going, takes away the mounts that only it allowed.

import { reconcileTeamMounts } from './afs-shares'
import * as db from './db/teams'

/** Remove the user from the team. False when they weren't a member. */
export async function removeTeamMember(teamId: string, userId: string): Promise<boolean> {
  const removed = await db.removeTeamMember(teamId, userId)
  if (removed) await reconcileTeamMounts()
  return removed
}

/** Delete the team. False when there was none. */
export async function deleteTeam(id: string): Promise<boolean> {
  const deleted = await db.deleteTeam(id)
  if (deleted) await reconcileTeamMounts()
  return deleted
}
