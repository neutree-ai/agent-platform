// What an application publishes for its users' agents (/apps/v1/prompts,
// /apps/v1/skills).
//
// It belongs to the application's owner account (migrations/152_app_owners.sql)
// and is shared with the application's team, so the application's users, and
// whoever else is in that team, can use it. An application names its content
// by its own names, which only have to be unique within the application.
//
// Publishing the same content again is a no-op: a prompt gets a new version
// only when its text changes, a skill only when its package bytes do.

import { deleteAppAgents } from './app-spec/apply'
import { getAppOwnerId, getAppTeamId } from './db/app-users'
import { pool } from './db/pool'
import { createPrompt, deletePrompt, setPromptGrants, updatePrompt } from './db/prompts'
import { skillsService } from './skills-composition'
import { InvalidInputError } from './skills-errors'

interface AppPrompt {
  name: string
  version: number
  updated_at: string
}

interface AppSkill {
  name: string
  description: string
  /** Counts the skill's distinct packages, oldest first. */
  version: number
  content_hash: string
  updated_at: string
}

async function appTeamGrant(clientId: string) {
  const teamId = await getAppTeamId(clientId)
  if (!teamId) throw new Error(`application ${clientId} has no team`)
  return [{ team_id: teamId, permission: 'viewer' as const }]
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

// ── prompts ──────────────────────────────────────────────────────────────────

async function findPrompt(ownerId: string, name: string) {
  const { rows } = await pool.query(
    'SELECT id, current_version, updated_at FROM prompts WHERE user_id = $1 AND name = $2',
    [ownerId, name],
  )
  return rows[0] as { id: string; current_version: number; updated_at: Date } | undefined
}

export async function listAppPrompts(clientId: string): Promise<AppPrompt[]> {
  const ownerId = await getAppOwnerId(clientId)
  const { rows } = await pool.query(
    'SELECT name, current_version, updated_at FROM prompts WHERE user_id = $1 ORDER BY name',
    [ownerId],
  )
  return rows.map((r) => ({
    name: r.name,
    version: r.current_version,
    updated_at: toIso(r.updated_at),
  }))
}

export async function putAppPrompt(
  clientId: string,
  name: string,
  content: string,
): Promise<{ prompt: AppPrompt; created: boolean }> {
  const ownerId = await getAppOwnerId(clientId)
  const existing = await findPrompt(ownerId, name)
  const prompt = existing
    ? await updatePrompt(existing.id, { content })
    : await createPrompt(ownerId, name, content, 'team')
  if (!prompt) throw new Error(`prompt ${name} vanished while publishing`)
  if (!existing) await setPromptGrants(prompt.id, await appTeamGrant(clientId), ownerId)
  return {
    prompt: { name, version: prompt.current_version, updated_at: toIso(prompt.updated_at) },
    created: !existing,
  }
}

/** False when the application has no prompt by that name. */
export async function deleteAppPrompt(clientId: string, name: string): Promise<boolean> {
  const existing = await findPrompt(await getAppOwnerId(clientId), name)
  return existing ? deletePrompt(existing.id) : false
}

// ── skills ───────────────────────────────────────────────────────────────────

const SKILL_COLUMNS = `
  s.id, s.name, s.description, s.updated_at, v.content_hash,
  (SELECT count(*) FROM skill_versions x
    WHERE x.skill_id = s.id AND (x.published_at, x.id) <= (v.published_at, v.id))::int AS version`

function toAppSkill(r: Record<string, unknown>): AppSkill {
  return {
    name: r.name as string,
    description: r.description as string,
    version: r.version as number,
    content_hash: r.content_hash as string,
    updated_at: toIso(r.updated_at as Date),
  }
}

async function findSkill(ownerId: string, name: string) {
  const { rows } = await pool.query(
    `SELECT ${SKILL_COLUMNS}
       FROM skills s LEFT JOIN skill_versions v ON v.id = s.active_version_id
      WHERE s.user_id = $1 AND s.name = $2`,
    [ownerId, name],
  )
  return rows[0] as Record<string, unknown> | undefined
}

export async function listAppSkills(clientId: string): Promise<AppSkill[]> {
  const ownerId = await getAppOwnerId(clientId)
  const { rows } = await pool.query(
    `SELECT ${SKILL_COLUMNS}
       FROM skills s LEFT JOIN skill_versions v ON v.id = s.active_version_id
      WHERE s.user_id = $1
      ORDER BY s.name`,
    [ownerId],
  )
  return rows.map(toAppSkill)
}

const asStream = (bytes: Uint8Array<ArrayBuffer>) =>
  new Blob([bytes]).stream() as ReadableStream<Uint8Array>

/**
 * Throws InvalidInputError unless the package has SKILL.md at its root. The
 * description defaults to the one SKILL.md gives.
 */
export async function putAppSkill(
  clientId: string,
  input: {
    name: string
    description?: string
    package: Uint8Array<ArrayBuffer>
    signal?: AbortSignal
  },
): Promise<{ skill: AppSkill; created: boolean }> {
  const { candidates } = await skillsService.scanTarball({
    userId: clientId,
    body: asStream(input.package),
    contentLength: input.package.byteLength,
    signal: input.signal,
  })
  const root = candidates.find((candidate) => candidate.subpath === '')
  if (!root) throw new InvalidInputError('The package has no SKILL.md at its root')

  const ownerId = await getAppOwnerId(clientId)
  const created = !(await findSkill(ownerId, input.name))
  const { skill } = await skillsService.uploadSkill({
    userId: ownerId,
    name: input.name,
    description: input.description ?? root.description ?? '',
    visibility: 'team',
    body: asStream(input.package),
    contentLength: input.package.byteLength,
    signal: input.signal,
  })
  if (created) await skillsService.setGrants(ownerId, skill.id, await appTeamGrant(clientId))
  const published = await findSkill(ownerId, input.name)
  if (!published) throw new Error(`skill ${input.name} vanished while publishing`)
  return { skill: toAppSkill(published), created }
}

/**
 * False when the application has no skill by that name. Throws the skills
 * service's ConflictError while a workspace or template still uses it.
 */
export async function deleteAppSkill(clientId: string, name: string): Promise<boolean> {
  const ownerId = await getAppOwnerId(clientId)
  const existing = await findSkill(ownerId, name)
  if (!existing) return false
  await skillsService.remove(ownerId, existing.id as string)
  return true
}

/**
 * Delete everything the application published, and its agents' templates,
 * before the application itself.
 */
export async function deleteAppContent(clientId: string): Promise<void> {
  const ownerId = await getAppOwnerId(clientId)
  // Templates go first: their current versions hold the skills.
  await deleteAppAgents(clientId)
  const { rows } = await pool.query('SELECT id FROM skills WHERE user_id = $1', [ownerId])
  for (const { id } of rows as { id: string }[]) await skillsService.remove(ownerId, id)
  // Prompts go with the owner account (ON DELETE CASCADE).
  await pool.query('DELETE FROM users WHERE id = $1', [ownerId])
}
