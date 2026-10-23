// Resolving a spec's references into what its agents' templates and
// workspaces are made of.
//
// A reference is looked up among what the application's owner account can
// see: what the application published, and what is shared with the
// application's team or public. What the application published wins over a
// shared resource of the same name; two shared ones of the same name are
// ambiguous. A prompt without a version is pinned to its current one.

import { createHash } from 'node:crypto'
import { getAppOwnerId } from '../db/app-users'
import { listVisibleToUser as listVisibleEnvironments } from '../db/environments'
import { listVisibleToUser as listVisibleProviders } from '../db/model-providers'
import { pool } from '../db/pool'
import { listVisibleToUser as listVisiblePrompts } from '../db/prompts'
import { serverOriginFromUrl } from '../mcp-oauth'
import { skillRepo } from '../skills-composition'
import { type AppSpec, SpecError } from './schema'

/** What an agent's template versions are made of. */
interface AgentTemplateConfig {
  agent_type: string
  provider_id: string
  model: string
  small_model: string
  prompt_id: string | null
  prompt_version: number | null
  skill_ids: string[]
  mcp_config: string
  agent_settings: string
  compute_resources: Record<string, string>
  commands: Array<{ name: string; content: string }>
  schedules: Array<{
    name: string
    cron: string
    timezone: string
    prompt: string
    enabled_default: boolean
  }>
}

/** What an agent's workspaces take beyond their template. */
export interface AgentRuntime {
  environment_id: string | null
  auto_scaling: {
    min_replicas: number
    max_replicas: number
    scale_to_zero_idle_seconds: number | null
  } | null
  max_concurrency: number | null
  max_steps: number | null
  /** Another agent of the spec calls this one, so its workspaces get a slug. */
  callable: boolean
}

export interface ResolvedAgent {
  template: AgentTemplateConfig
  runtime: AgentRuntime
}

export interface ResolvedSpec {
  agents: Record<string, ResolvedAgent>
  /** Origins of the MCP servers that identify their callers. */
  mcp_origins: string[]
}

interface Named {
  id: string
  name: string
  is_owner: boolean
}

function pick<T extends Named>(
  kind: string,
  candidates: T[],
  name: string,
  issues: string[],
): T | null {
  const matches = candidates.filter((c) => c.name === name)
  const own = matches.find((c) => c.is_owner)
  if (own) return own
  if (matches.length === 1) return matches[0]
  issues.push(
    matches.length === 0
      ? `${kind} ${name} is not published by or shared with the application`
      : `${kind} ${name} is ambiguous: ${matches.length} shared with the application have that name`,
  )
  return null
}

async function promptVersionExists(promptId: string, version: number): Promise<boolean> {
  const { rows } = await pool.query(
    'SELECT 1 FROM prompt_versions WHERE prompt_id = $1 AND version = $2',
    [promptId, version],
  )
  return rows.length > 0
}

/**
 * Resolve every reference of the spec. Returns the resolved spec and, per
 * agent, its prompt reference as locked (`name@version`). Throws SpecError
 * listing every reference that can't be resolved.
 */
export async function resolveAppSpec(
  clientId: string,
  spec: AppSpec,
): Promise<{ resolved: ResolvedSpec; promptLocks: Record<string, string> }> {
  const ownerId = await getAppOwnerId(clientId)
  const [providers, prompts, skills, environments] = await Promise.all([
    listVisibleProviders(ownerId),
    listVisiblePrompts(ownerId),
    skillRepo.listVisibleToUser(ownerId),
    listVisibleEnvironments(ownerId),
  ])

  const issues: string[] = []
  const promptLocks: Record<string, string> = {}
  const servers = spec.mcp_servers ?? {}
  const callees = new Set(Object.values(spec.agents).flatMap((a) => a.calls ?? []))
  const agents: Record<string, ResolvedAgent> = {}

  for (const [name, agent] of Object.entries(spec.agents)) {
    const provider = pick('provider', providers, agent.model.provider, issues)

    let prompt: { id: string; version: number } | null = null
    if (agent.prompt) {
      const [promptName, pinned] = agent.prompt.split('@')
      const found = pick('prompt', prompts, promptName, issues)
      if (found) {
        const version = pinned ? Number(pinned) : found.current_version
        if (pinned && !(await promptVersionExists(found.id, version))) {
          issues.push(`prompt ${promptName} has no version ${version}`)
        } else {
          prompt = { id: found.id, version }
          promptLocks[name] = `${promptName}@${version}`
        }
      }
    }

    const skillIds: string[] = []
    for (const skillName of new Set(agent.skills ?? [])) {
      const skill = pick('skill', skills, skillName, issues)
      if (skill) skillIds.push(skill.id)
    }

    const environment = agent.runtime.environment
      ? pick('environment', environments, agent.runtime.environment, issues)
      : null

    const mcpServers: Record<string, unknown> = {}
    for (const server of Object.keys(agent.mcp ?? {}).sort()) {
      const { url, headers } = servers[server]
      mcpServers[server] = { type: 'http', url, ...(headers ? { headers } : {}) }
    }

    agents[name] = {
      template: {
        agent_type: agent.runtime.agent_type,
        provider_id: provider?.id ?? '',
        model: agent.model.name,
        small_model: agent.model.small ?? '',
        prompt_id: prompt?.id ?? null,
        prompt_version: prompt?.version ?? null,
        skill_ids: skillIds.sort(),
        mcp_config: Object.keys(mcpServers).length > 0 ? JSON.stringify({ mcpServers }) : '{}',
        agent_settings:
          typeof agent.settings === 'string'
            ? agent.settings
            : JSON.stringify(agent.settings ?? {}),
        compute_resources: agent.runtime.compute ?? {},
        commands: Object.entries(agent.commands ?? {})
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([commandName, c]) => ({ name: commandName, content: c.content })),
        schedules: Object.entries(agent.schedules ?? {})
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([scheduleName, s]) => ({
            name: scheduleName,
            cron: s.cron,
            timezone: s.timezone,
            prompt: s.prompt,
            enabled_default: s.enabled,
          })),
      },
      runtime: {
        environment_id: environment?.id ?? null,
        auto_scaling: agent.runtime.scaling ?? null,
        max_concurrency: agent.runtime.max_concurrency ?? null,
        max_steps: agent.runtime.max_steps ?? null,
        callable: callees.has(name),
      },
    }
  }

  if (issues.length > 0) throw new SpecError(issues)

  const mcpOrigins = Object.values(servers)
    .filter((s) => s.identify_caller)
    .map((s) => serverOriginFromUrl(s.url))
  return {
    resolved: { agents, mcp_origins: [...new Set(mcpOrigins)].sort() },
    promptLocks,
  }
}

/** JSON with object keys sorted, so equal values serialize alike. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )
}

export function hashResolvedSpec(resolved: ResolvedSpec): string {
  return createHash('sha256').update(canonicalJson(resolved)).digest('hex')
}
