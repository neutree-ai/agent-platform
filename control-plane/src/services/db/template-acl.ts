import { pool } from './pool'
import type { TemplateVisibility } from './types'

/**
 * For a template that is being shared (visibility != private), the linked
 * prompt and provider must remain reachable for the same audience. This
 * keeps the share intent transparent: a team granted access to a template
 * can also see/use every resource the template injects, no hidden content.
 *
 * Single invariant covering all template write paths (meta, version,
 * grants): for each grant team T (or "public" if visibility=public), the
 * referenced prompt/provider must be visible to T, where "visible" means
 * owned-by-link-owner OR public OR has a grant to T.
 *
 * Reverse direction (prompt/provider visibility shrinking) is intentionally
 * NOT enforced here — only the template owner's writes trip the check.
 */

type TemplateLinkScope = { kind: 'public' } | { kind: 'team'; team_id: string }

interface LinkMissingItem {
  resource: 'prompt' | 'provider' | 'skill'
  resource_id: string
  resource_name: string
  scope: { kind: 'public' } | { kind: 'team'; team_id: string; team_name: string }
}

interface LinkInputs {
  templateOwnerId: string
  visibility: TemplateVisibility
  /** Team grants the template will have after this write. */
  grantTeamIds: string[]
  /** prompt_id from the (current or pending) latest version, or null. */
  promptId: string | null
  /** provider_id from the (current or pending) latest version, or null. */
  providerId: string | null
  /** Skill UUIDs the (current or pending) latest version enables. */
  skillIds?: string[]
}

/**
 * Check whether the template's referenced prompt and provider satisfy the
 * link invariant for the proposed (visibility, grants). Returns a list of
 * missing items (empty if OK). The caller should reject the write with 400
 * + the list when missing.length > 0.
 *
 * Resource ownership note: the prompt/provider don't have to be owned by
 * the template owner. If `lisi` made a public prompt and `zhangsan`'s
 * shared template references it, the prompt is visible to all teams via
 * its own visibility=public — that satisfies the invariant.
 */
export async function assertTemplateLinkVisible(input: LinkInputs): Promise<LinkMissingItem[]> {
  const { visibility, grantTeamIds, promptId, providerId, skillIds = [] } = input

  // Private templates have no audience to check against.
  if (visibility === 'private') return []

  // Audience: public is one slot; team is each grant team_id.
  const audience: TemplateLinkScope[] =
    visibility === 'public'
      ? [{ kind: 'public' }]
      : grantTeamIds.map((team_id) => ({ kind: 'team' as const, team_id }))

  if (audience.length === 0) return []

  const missing: LinkMissingItem[] = []
  for (const slot of audience) {
    if (promptId) {
      const item = await checkResourceVisibility('prompt', promptId, slot)
      if (item) missing.push(item)
    }
    if (providerId) {
      const item = await checkResourceVisibility('provider', providerId, slot)
      if (item) missing.push(item)
    }
    for (const skillId of skillIds) {
      const item = await checkSkillVisibility(skillId, slot)
      if (item) missing.push(item)
    }
  }
  return missing
}

// p3: skills key on `id` (UUID) and `skill_grants` FKs by `skill_id`. We keep
// the resource_name surface for the UI by reading the skill's display name in
// the same row.
async function checkSkillVisibility(
  skillId: string,
  scope: TemplateLinkScope,
): Promise<LinkMissingItem | null> {
  const { rows } = await pool.query('SELECT id, name, visibility FROM skills WHERE id = $1', [
    skillId,
  ])
  if (rows.length === 0) {
    return {
      resource: 'skill',
      resource_id: skillId,
      resource_name: '(deleted)',
      scope: scope.kind === 'public' ? { kind: 'public' } : { ...scope, team_name: '' },
    }
  }
  const row = rows[0] as {
    id: string
    name: string
    visibility: 'private' | 'team' | 'public'
  }
  if (scope.kind === 'public') {
    if (row.visibility === 'public') return null
    return {
      resource: 'skill',
      resource_id: row.id,
      resource_name: row.name,
      scope: { kind: 'public' },
    }
  }
  if (row.visibility === 'public') return null
  const grantCheck = await pool.query(
    'SELECT 1 FROM skill_grants WHERE skill_id = $1 AND team_id = $2 LIMIT 1',
    [skillId, scope.team_id],
  )
  if (grantCheck.rows.length > 0) return null
  const teamRow = await pool.query('SELECT name FROM teams WHERE id = $1', [scope.team_id])
  const team_name = (teamRow.rows[0]?.name as string) ?? scope.team_id
  return {
    resource: 'skill',
    resource_id: row.id,
    resource_name: row.name,
    scope: { kind: 'team', team_id: scope.team_id, team_name },
  }
}

async function checkResourceVisibility(
  kind: 'prompt' | 'provider',
  resourceId: string,
  scope: TemplateLinkScope,
): Promise<LinkMissingItem | null> {
  const table = kind === 'prompt' ? 'prompts' : 'model_providers'
  const grantsTable = kind === 'prompt' ? 'prompt_grants' : 'provider_grants'
  const fk = kind === 'prompt' ? 'prompt_id' : 'provider_id'

  const { rows } = await pool.query(`SELECT id, name, visibility FROM ${table} WHERE id = $1`, [
    resourceId,
  ])
  if (rows.length === 0) {
    // Dangling reference — surface as missing so user fixes it.
    return {
      resource: kind,
      resource_id: resourceId,
      resource_name: '(deleted)',
      scope: scope.kind === 'public' ? { kind: 'public' } : { ...scope, team_name: '' },
    }
  }
  const row = rows[0] as { id: string; name: string; visibility: 'private' | 'team' | 'public' }

  if (scope.kind === 'public') {
    // Whole-world audience: only public resources satisfy.
    if (row.visibility === 'public') return null
    return {
      resource: kind,
      resource_id: row.id,
      resource_name: row.name,
      scope: { kind: 'public' },
    }
  }

  // Team audience: public resources satisfy; otherwise the team must hold a grant.
  if (row.visibility === 'public') return null
  const grantCheck = await pool.query(
    `SELECT 1 FROM ${grantsTable} WHERE ${fk} = $1 AND team_id = $2 LIMIT 1`,
    [resourceId, scope.team_id],
  )
  if (grantCheck.rows.length > 0) return null

  // Need team name for a useful error message.
  const teamRow = await pool.query('SELECT name FROM teams WHERE id = $1', [scope.team_id])
  const team_name = (teamRow.rows[0]?.name as string) ?? scope.team_id
  return {
    resource: kind,
    resource_id: row.id,
    resource_name: row.name,
    scope: { kind: 'team', team_id: scope.team_id, team_name },
  }
}
