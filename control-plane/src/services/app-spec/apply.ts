// Applying an application spec: plan it against the spec in force, store it
// as a new version, and turn each agent into a template version.
//
// Each agent is a template the application's owner account owns. A new
// template version is written only when what the template is made of
// changes; the rest of an agent (environment, replica bounds, limits) is kept
// with the agent, for its workspaces to take.

import { getAppOwnerId, mcpOriginsTakenByOthers, setClientMcpOrigins } from '../db/app-users'
import { pool } from '../db/pool'
import { createTemplate, createTemplateVersion, deleteTemplate } from '../db/templates'
import {
  type ResolvedAgent,
  type ResolvedSpec,
  canonicalJson,
  hashResolvedSpec,
  resolveAppSpec,
} from './resolve'
import type { ParsedSpec } from './schema'

interface PlanEntry {
  agent: string
  action: 'create' | 'update' | 'delete' | 'unchanged'
  /** For an update: the fields that change. */
  changes?: string[]
}

interface ApplyResult {
  version: number
  hash: string
  /** False when the spec resolved to the one already in force. */
  changed: boolean
  plan: PlanEntry[]
}

/** The spec drops agents and `prune` wasn't given, or it claims taken origins. */
export class SpecConflictError extends Error {}

interface StoredSpec {
  version: number
  hash: string
  /** The spec as written, each prompt reference locked to its version. */
  document: Record<string, unknown>
  resolved: ResolvedSpec
  created_at: Date
}

export async function getCurrentSpec(clientId: string): Promise<StoredSpec | null> {
  const { rows } = await pool.query(
    `SELECT version, hash, document, resolved, created_at FROM app_specs
      WHERE client_id = $1 ORDER BY version DESC LIMIT 1`,
    [clientId],
  )
  return (rows[0] as StoredSpec) ?? null
}

interface AppAgentRow {
  name: string
  template_id: string
  runtime: ResolvedAgent['runtime']
}

async function listAppAgents(clientId: string): Promise<AppAgentRow[]> {
  const { rows } = await pool.query(
    'SELECT name, template_id, runtime FROM app_agents WHERE client_id = $1 ORDER BY name',
    [clientId],
  )
  return rows as AppAgentRow[]
}

function diff(before: ResolvedAgent, after: ResolvedAgent): string[] {
  const changes: string[] = []
  for (const part of ['template', 'runtime'] as const) {
    const keys = new Set([...Object.keys(before[part]), ...Object.keys(after[part])])
    for (const key of keys) {
      const a = (before[part] as unknown as Record<string, unknown>)[key]
      const b = (after[part] as unknown as Record<string, unknown>)[key]
      if (canonicalJson(a) !== canonicalJson(b)) changes.push(key)
    }
  }
  return changes.sort()
}

function plan(
  current: StoredSpec | null,
  existing: AppAgentRow[],
  next: ResolvedSpec,
): PlanEntry[] {
  const entries: PlanEntry[] = []
  const existingNames = new Set(existing.map((a) => a.name))
  for (const [name, agent] of Object.entries(next.agents)) {
    const before = existingNames.has(name) ? current?.resolved.agents[name] : undefined
    if (!before) {
      entries.push({ agent: name, action: existingNames.has(name) ? 'update' : 'create' })
      continue
    }
    const changes = diff(before, agent)
    entries.push(
      changes.length > 0
        ? { agent: name, action: 'update', changes }
        : { agent: name, action: 'unchanged' },
    )
  }
  for (const name of existingNames) {
    if (!next.agents[name]) entries.push({ agent: name, action: 'delete' })
  }
  return entries.sort((a, b) => a.agent.localeCompare(b.agent))
}

/** Remove an agent the spec no longer declares, with its template. */
async function removeAgent(clientId: string, agent: AppAgentRow): Promise<void> {
  await pool.query('DELETE FROM app_agents WHERE client_id = $1 AND name = $2', [
    clientId,
    agent.name,
  ])
  await deleteTemplate(agent.template_id)
}

/**
 * Plan the spec and, unless `dryRun`, apply it. Applies of one application
 * run one at a time. Throws SpecError when a reference doesn't resolve, and
 * SpecConflictError when the spec drops agents without `prune` or declares an
 * MCP origin another application has.
 */
export async function applyAppSpec(
  clientId: string,
  { spec, document }: ParsedSpec,
  opts: { dryRun?: boolean; prune?: boolean } = {},
): Promise<ApplyResult> {
  const lock = await pool.connect()
  try {
    await lock.query('SELECT pg_advisory_lock(hashtext($1))', [`app-spec:${clientId}`])

    const { resolved, promptLocks } = await resolveAppSpec(clientId, spec)
    const hash = hashResolvedSpec(resolved)
    const current = await getCurrentSpec(clientId)
    const existing = await listAppAgents(clientId)
    const entries = plan(current, existing, resolved)

    if (current && current.hash === hash) {
      return { version: current.version, hash, changed: false, plan: entries }
    }
    const nextVersion = (current?.version ?? 0) + 1
    if (opts.dryRun) return { version: nextVersion, hash, changed: true, plan: entries }

    const dropped = existing.filter((a) => !resolved.agents[a.name])
    if (dropped.length > 0 && !opts.prune) {
      throw new SpecConflictError(
        `The spec drops agents ${dropped.map((a) => a.name).join(', ')}; apply it with prune to delete them`,
      )
    }
    const taken = await mcpOriginsTakenByOthers(clientId, resolved.mcp_origins)
    if (taken.length > 0) {
      throw new SpecConflictError(
        `MCP servers already declared by another application: ${taken.join(', ')}`,
      )
    }

    for (const agent of dropped) await removeAgent(clientId, agent)

    const ownerId = await getAppOwnerId(clientId)
    const byName = new Map(existing.map((a) => [a.name, a]))
    for (const [name, agent] of Object.entries(resolved.agents)) {
      let templateId = byName.get(name)?.template_id
      if (!templateId) {
        templateId = (await createTemplate(ownerId, name, '')).id
        await pool.query(
          'INSERT INTO app_agents (client_id, name, template_id, runtime) VALUES ($1, $2, $3, $4)',
          [clientId, name, templateId, JSON.stringify(agent.runtime)],
        )
      } else {
        await pool.query('UPDATE app_agents SET runtime = $3 WHERE client_id = $1 AND name = $2', [
          clientId,
          name,
          JSON.stringify(agent.runtime),
        ])
      }
      // A new agent has no version yet; an existing one gets one when its template changes.
      const before = current?.resolved.agents[name]?.template
      if (!before || canonicalJson(before) !== canonicalJson(agent.template)) {
        await createTemplateVersion(templateId, {
          ...agent.template,
          commands: agent.template.commands.map((c, i) => ({ ...c, sort_order: i })),
          schedules: agent.template.schedules.map((s, i) => ({ ...s, sort_order: i })),
        })
      }
    }

    const locked = structuredClone(document) as { agents: Record<string, { prompt?: string }> }
    for (const [name, prompt] of Object.entries(promptLocks)) locked.agents[name].prompt = prompt

    await setClientMcpOrigins(clientId, resolved.mcp_origins)
    await pool.query(
      `INSERT INTO app_specs (client_id, version, hash, document, resolved)
       VALUES ($1, $2, $3, $4, $5)`,
      [clientId, nextVersion, hash, JSON.stringify(locked), JSON.stringify(resolved)],
    )
    return { version: nextVersion, hash, changed: true, plan: entries }
  } finally {
    await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [`app-spec:${clientId}`])
    lock.release()
  }
}

/** Remove every agent of the application with its template, before the application itself. */
export async function deleteAppAgents(clientId: string): Promise<void> {
  for (const agent of await listAppAgents(clientId)) await removeAgent(clientId, agent)
}
