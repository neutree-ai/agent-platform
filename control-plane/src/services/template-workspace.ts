// Putting a workspace on a template version: what creating a workspace from a
// template and syncing one to a newer version share.
//
// A template-bound workspace reads most of its config through the template
// version it points at (see getWorkspaceConfig); skills, schedules and the
// layout are materialized into the workspace's own rows here.

import { getTemplateVersion } from './db/templates'
import { getWorkspaceConfig, updateWorkspaceConfig } from './db/workspaces'
import { skillRepo } from './skills-composition'
import { materializeTemplateLayout, reconcileTemplateLayout } from './template-layout'
import { materializeTemplateSchedules, reconcileTemplateSchedules } from './template-schedules'

interface TemplateTarget {
  workspaceId: string
  /** The workspace's owner, who must be able to see the version's skills. */
  userId: string
  templateId: string
  version: number
  /** Consent for schedules the version brings: name → enabled. */
  scheduleOverrides?: Record<string, boolean>
}

/** The version's skills the user can't see; empty when it can see them all. */
async function skillsNotVisible(skillIds: string[], userId: string): Promise<string[]> {
  return skillIds.length > 0 ? skillRepo.findSkillIdsNotVisibleToUser(skillIds, userId) : []
}

/**
 * Bind a newly created workspace to a template version. Returns the skills
 * the user can't see, and binds nothing more, when there are any.
 */
export async function bindWorkspaceToTemplate(
  target: TemplateTarget,
): Promise<{ notVisible: string[] }> {
  const { workspaceId, userId, templateId, version } = target
  await updateWorkspaceConfig(workspaceId, { template_id: templateId, template_version: version })
  const tv = await getTemplateVersion(templateId, version)
  if (tv && tv.skill_ids.length > 0) {
    const notVisible = await skillsNotVisible(tv.skill_ids, userId)
    if (notVisible.length > 0) return { notVisible }
    await skillRepo.setWorkspaceSkills(workspaceId, tv.skill_ids)
  }
  await materializeTemplateSchedules({ ...target, enabledOverrides: target.scheduleOverrides })
  await materializeTemplateLayout(target)
  return { notVisible: [] }
}

/**
 * Move a bound workspace to another version of its template. Returns the
 * skills the user can't see, and changes nothing, when there are any.
 */
export async function syncWorkspaceToTemplate(
  target: TemplateTarget,
): Promise<{ notVisible: string[] }> {
  const { workspaceId, userId, templateId, version } = target
  const tv = await getTemplateVersion(templateId, version)
  const notVisible = await skillsNotVisible(tv?.skill_ids ?? [], userId)
  if (notVisible.length > 0) return { notVisible }

  // Only the skills the template brought are replaced: the ones the version
  // the workspace is on lists go, the new version's come. Skills added to
  // the workspace itself stay.
  const config = await getWorkspaceConfig(workspaceId)
  const from = config?.template_version
    ? await getTemplateVersion(templateId, config.template_version)
    : null
  const fromTemplate = new Set(from?.skill_ids ?? [])
  const own = (await skillRepo.getWorkspaceSkillIds(workspaceId)).filter(
    (id) => !fromTemplate.has(id),
  )
  const skillIds = [...new Set([...own, ...(tv?.skill_ids ?? [])])]

  await updateWorkspaceConfig(workspaceId, { template_version: version })
  await skillRepo.setWorkspaceSkills(workspaceId, skillIds)
  // Template schedules are matched by name: new ones are added, removed ones
  // dropped, changed ones refreshed keeping the user's on/off toggle.
  await reconcileTemplateSchedules({ ...target, enabledOverrides: target.scheduleOverrides })
  // Refresh the template-origin layout copy; auto-adopt for pristine workspaces.
  await reconcileTemplateLayout(target)
  return { notVisible: [] }
}
