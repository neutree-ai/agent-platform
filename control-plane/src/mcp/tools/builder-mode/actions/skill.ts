import {
  BUILDER_KIND_SKILL_DISABLE,
  BUILDER_KIND_SKILL_ENABLE,
  SkillDisablePayloadSchema,
  SkillEnablePayloadSchema,
} from '../../../../../../internal/types/builder'
import { getWorkspace } from '../../../../services/db/workspaces'
import { skillRepo, skillsService } from '../../../../services/skills-composition'
import { defineBuilderAction } from '../define-action'

/**
 * Resolve a list of skill names to their UUIDs, scoped to the workspace owner.
 * p3 dropped the global name uniqueness invariant — names are unique only per
 * owner — so picking a skill by name always requires an owner context. Names
 * that don't resolve are returned in `missing` so the caller can surface them.
 */
async function resolveNamesForWorkspace(
  workspaceId: string,
  names: string[],
): Promise<{ ids: Map<string, string>; missing: string[] }> {
  const ws = await getWorkspace(workspaceId)
  if (!ws) throw new Error('Workspace not found')
  const ids = new Map<string, string>()
  const missing: string[] = []
  for (const name of names) {
    const skill = await skillRepo.getSkillByNameForUser(name, ws.user_id)
    if (skill) ids.set(name, skill.id)
    else missing.push(name)
  }
  return { ids, missing }
}

export const skillEnableAction = defineBuilderAction({
  kind: BUILDER_KIND_SKILL_ENABLE,
  resource: 'skill_enable',
  payload: SkillEnablePayloadSchema,
  label: 'Attach skills to workspace',
  proposeDescription:
    'Attach one or more existing skills to the current workspace. Skill names come from `list_skills`. See `__platform__:reference/builder-mode.md` for the contract.',
  apply: async ({ workspaceId, payload }) => {
    const requested = Array.from(new Set(payload.names))
    const { ids, missing } = await resolveNamesForWorkspace(workspaceId, requested)
    if (missing.length > 0) {
      return `No change — unknown skill name(s): ${missing.join(', ')}.`
    }
    const requestedIds = Array.from(ids.values())
    const current = await skillRepo.getWorkspaceSkillIds(workspaceId)
    const added = requestedIds.filter((id) => !current.includes(id))
    if (added.length === 0) {
      return `No change — all ${requested.length} skill(s) already attached.`
    }
    const merged = Array.from(new Set([...current, ...requestedIds]))
    await skillsService.attachToWorkspace(workspaceId, merged)
    return `Attached ${added.length} skill(s): ${requested.join(', ')}.`
  },
})

export const skillDisableAction = defineBuilderAction({
  kind: BUILDER_KIND_SKILL_DISABLE,
  resource: 'skill_disable',
  payload: SkillDisablePayloadSchema,
  label: 'Detach skills from workspace',
  proposeDescription:
    'Detach one or more skills from the current workspace. See `__platform__:reference/builder-mode.md` for the contract.',
  apply: async ({ workspaceId, payload }) => {
    const requested = Array.from(new Set(payload.names))
    const { ids } = await resolveNamesForWorkspace(workspaceId, requested)
    const dropIds = new Set(ids.values())
    const current = await skillRepo.getWorkspaceSkillIds(workspaceId)
    const removed = current.filter((id) => dropIds.has(id))
    if (removed.length === 0) {
      return 'No change — none of the named skills were attached.'
    }
    const next = current.filter((id) => !dropIds.has(id))
    await skillsService.attachToWorkspace(workspaceId, next)
    return `Detached ${removed.length} skill(s): ${requested.join(', ')}.`
  },
})
