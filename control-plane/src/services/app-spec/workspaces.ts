// The workspaces of an application's users: one per user and agent of the
// spec, created from the agent's template the first time the application asks
// for it, and kept in line with the agent afterwards.
//
// When the spec changes an agent, each of its workspaces moves to the new
// template version and takes the agent's new runtime, but only while no turn
// is running in it: a busy workspace is left for the next pass of the sweep.
//
// The user's shared folders (see folders.ts) are brought in line along with
// each workspace that is ensured, and by the same sweep.

import { notifyAgentReload } from '../../lib/workspace-address'
import { pool } from '../db/pool'
import { listActiveSessionIds } from '../db/sessions'
import { getTemplateVersion } from '../db/templates'
import type { User } from '../db/types'
import {
  createWorkspace,
  getWorkspace,
  getWorkspaceConfig,
  updateWorkspace,
  updateWorkspaceConfig,
} from '../db/workspaces'
import { bumpWorkspaceSpec, placeWorkspace } from '../placement'
import { chooseEnvironment } from '../placement-decision'
import { bindWorkspaceToTemplate, syncWorkspaceToTemplate } from '../template-workspace'
import { destroyWorkspace } from '../workspace-lifecycle'
import { attachDefaultMemoryStore } from '../workspace-memory'
import { reconcileWorkspacePod } from '../workspace-reconcile'
import { bringUserFoldersInLine, convergeAppFolders } from './folders'
import { type AgentRuntime, canonicalJson } from './resolve'

/** The spec has no agent by that name. */
export class AgentNotFoundError extends Error {}

/** No environment the user can use fits the agent. */
export class AgentPlacementError extends Error {}

interface AgentWorkspace {
  agent: string
  workspace_id: string
  status: string
  template_version: number
  /** On the agent's latest template version, with its current runtime. */
  up_to_date: boolean
  /** Why it can't follow its agent or have its shared folders, while it can't. */
  blocked: string | null
}

interface AppWorkspaceRow {
  client_id: string
  agent: string
  user_id: string
  workspace_id: string
  runtime: AgentRuntime
  template_id: string
  agent_runtime: AgentRuntime
  template_version: number
  latest_version: number
  status: string
  blocked: string | null
  folders_blocked: string | null
}

const ROW_SQL = `
  SELECT aw.client_id, aw.agent, aw.user_id, aw.workspace_id, aw.runtime,
         a.template_id, a.runtime AS agent_runtime,
         wc.template_version, t.latest_version, w.status, aw.blocked, aw.folders_blocked
    FROM app_workspaces aw
    JOIN app_agents a ON a.client_id = aw.client_id AND a.name = aw.agent
    JOIN templates t ON t.id = a.template_id
    JOIN workspaces w ON w.id = aw.workspace_id
    JOIN workspace_config wc ON wc.workspace_id = aw.workspace_id`

function isUpToDate(row: AppWorkspaceRow): boolean {
  return (
    row.template_version === row.latest_version &&
    canonicalJson(row.runtime) === canonicalJson(row.agent_runtime)
  )
}

function toAgentWorkspace(row: AppWorkspaceRow): AgentWorkspace {
  return {
    agent: row.agent,
    workspace_id: row.workspace_id,
    status: row.status,
    template_version: row.template_version,
    up_to_date: isUpToDate(row),
    // One reason for the caller, from the two places a workspace can be stuck.
    blocked: [row.blocked, row.folders_blocked].filter((r) => r !== null).join('; ') || null,
  }
}

async function findRow(
  clientId: string,
  agent: string,
  userId: string,
): Promise<AppWorkspaceRow | null> {
  const { rows } = await pool.query(
    `${ROW_SQL} WHERE aw.client_id = $1 AND aw.agent = $2 AND aw.user_id = $3`,
    [clientId, agent, userId],
  )
  return (rows[0] as AppWorkspaceRow) ?? null
}

/**
 * Give the workspace the parts of the agent's runtime a workspace can change
 * after creation. A change between single-replica and scaling applies to new
 * workspaces only.
 */
async function applyRuntime(workspaceId: string, agent: string, runtime: AgentRuntime) {
  const config = await getWorkspaceConfig(workspaceId)
  await updateWorkspaceConfig(workspaceId, {
    max_concurrency: runtime.max_concurrency ?? 10,
    max_steps: runtime.max_steps,
    ...(config?.auto_scaling && runtime.auto_scaling ? { auto_scaling: runtime.auto_scaling } : {}),
  })
  // Agents call each other by slug, as the same user.
  await updateWorkspace(
    workspaceId,
    runtime.callable ? { slug: agent, visibility: 'user' } : { slug: null, visibility: 'private' },
  )
}

async function createAgentWorkspace(clientId: string, user: User, agent: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT a.template_id, a.runtime, t.latest_version
       FROM app_agents a JOIN templates t ON t.id = a.template_id
      WHERE a.client_id = $1 AND a.name = $2`,
    [clientId, agent],
  )
  if (rows.length === 0) throw new AgentNotFoundError(`No agent ${agent} in the spec`)
  const { template_id: templateId, latest_version: version } = rows[0]
  const runtime = rows[0].runtime as AgentRuntime
  const placement = await chooseEnvironment({
    userId: user.id,
    isSystem: false,
    requestedEnvironmentId: runtime.environment_id ?? undefined,
    required: { multiReplica: runtime.auto_scaling ? true : undefined },
  })
  if (!placement.ok) throw new AgentPlacementError(placement.error)

  // No agent type of its own: it follows the template's, like the rest.
  const workspace = await createWorkspace(user.id, agent, '', false, { seedDefaultPrompt: false })
  try {
    const { notVisible } = await bindWorkspaceToTemplate({
      workspaceId: workspace.id,
      userId: user.id,
      templateId,
      version,
    })
    if (notVisible.length > 0) {
      throw new Error(`skills not visible to the user: ${notVisible.join(', ')}`)
    }
    if (runtime.auto_scaling) {
      await updateWorkspaceConfig(workspace.id, { auto_scaling: runtime.auto_scaling })
    }
    await applyRuntime(workspace.id, agent, runtime)
    await pool.query(
      `INSERT INTO app_workspaces (client_id, agent, user_id, workspace_id, runtime)
       VALUES ($1, $2, $3, $4, $5)`,
      [clientId, agent, user.id, workspace.id, JSON.stringify(runtime)],
    )
  } catch (e) {
    // The whole way a workspace is deleted, so the schedule timers the
    // template brought go with it. It never ran, so there's no usage to drain.
    // A cleanup that fails is logged, and what made the creation fail is thrown.
    await destroyWorkspace(workspace, true).catch((cleanup) =>
      console.error(`[app-spec] deleting half-created workspace ${workspace.id} failed:`, cleanup),
    )
    throw e
  }
  // Last: it never fails, and a store made before a failure above would be
  // left behind by the delete.
  await attachDefaultMemoryStore({
    workspaceId: workspace.id,
    userId: user.id,
    name: agent,
    persistentMemory: placement.supports.persistentMemory,
  })
  await placeWorkspace(workspace.id, placement.environmentId)
  await updateWorkspace(workspace.id, { status: 'starting' })
}

/**
 * Bring the user's shared folders in line, now that one of its workspaces
 * exists. A folder that can't be is told in its workspace's blocked reason;
 * anything else that goes wrong is left to the sweep, rather than failing the
 * workspace's caller over a folder.
 */
async function bringFoldersInLine(clientId: string, userId: string): Promise<void> {
  try {
    await bringUserFoldersInLine(clientId, userId)
  } catch (e) {
    console.error(`[app-spec] shared folders of user ${userId} failed:`, e)
  }
}

/**
 * The user's workspace for the agent, created on the first call. An existing
 * one that is behind the agent and idle is brought up to date first. Either
 * way, the user's shared folders are brought in line. Throws
 * AgentNotFoundError and AgentPlacementError.
 */
export async function ensureAgentWorkspace(
  clientId: string,
  user: User,
  agent: string,
): Promise<{ workspace: AgentWorkspace; created: boolean }> {
  const existing = await findRow(clientId, agent, user.id)
  if (existing) {
    if (!isUpToDate(existing)) await convergeWorkspace(existing)
    await bringFoldersInLine(clientId, user.id)
    const row = (await findRow(clientId, agent, user.id)) ?? existing
    return { workspace: toAgentWorkspace(row), created: false }
  }

  // Concurrent first calls for one user and agent create one workspace.
  const lock = await pool.connect()
  const key = `app-workspace:${clientId}:${agent}:${user.id}`
  let created = false
  try {
    await lock.query('SELECT pg_advisory_lock(hashtext($1))', [key])
    if (!(await findRow(clientId, agent, user.id))) {
      await createAgentWorkspace(clientId, user, agent)
      created = true
    }
  } finally {
    await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [key])
    lock.release()
  }
  await bringFoldersInLine(clientId, user.id)
  const row = await findRow(clientId, agent, user.id)
  if (!row) throw new Error(`workspace for ${agent} vanished while creating it`)
  return { workspace: toAgentWorkspace(row), created }
}

export async function listUserAgentWorkspaces(
  clientId: string,
  userId: string,
): Promise<AgentWorkspace[]> {
  const { rows } = await pool.query(
    `${ROW_SQL} WHERE aw.client_id = $1 AND aw.user_id = $2 ORDER BY aw.agent`,
    [clientId, userId],
  )
  return (rows as AppWorkspaceRow[]).map(toAgentWorkspace)
}

/** Delete the user's workspace for the agent. False when it has none. */
export async function deleteAgentWorkspace(
  clientId: string,
  userId: string,
  agent: string,
): Promise<boolean> {
  const row = await findRow(clientId, agent, userId)
  const workspace = row && (await getWorkspace(row.workspace_id))
  if (!workspace) return false
  await destroyWorkspace(workspace)
  return true
}

/** Delete every user's workspace for the agent, before the agent itself. */
export async function deleteAllAgentWorkspaces(clientId: string, agent: string): Promise<void> {
  const { rows } = await pool.query(
    'SELECT workspace_id FROM app_workspaces WHERE client_id = $1 AND agent = $2',
    [clientId, agent],
  )
  for (const { workspace_id } of rows as { workspace_id: string }[]) {
    const workspace = await getWorkspace(workspace_id)
    if (workspace) await destroyWorkspace(workspace)
  }
}

/**
 * Bring one workspace up to date with its agent, unless a turn is running in
 * it. Runs one at a time per workspace, across control-plane replicas.
 */
async function convergeWorkspace(row: AppWorkspaceRow): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok', [
      `app-workspace-converge:${row.workspace_id}`,
    ])
    if (!rows[0].ok) return
    if ((await listActiveSessionIds(row.workspace_id)).length > 0) return

    let computeChanged = false
    if (row.template_version !== row.latest_version) {
      const before = await getTemplateVersion(row.template_id, row.template_version)
      const after = await getTemplateVersion(row.template_id, row.latest_version)
      const { notVisible } = await syncWorkspaceToTemplate({
        workspaceId: row.workspace_id,
        userId: row.user_id,
        templateId: row.template_id,
        version: row.latest_version,
      })
      if (notVisible.length > 0) {
        // Tried again on every pass, since the skills may be shared later;
        // said once, and shown in the status until then.
        const blocked = `skills not visible to the user: ${notVisible.join(', ')}`
        if (blocked !== row.blocked) {
          console.error(
            `[app-spec] workspace ${row.workspace_id} can't follow its agent: ${blocked}`,
          )
          await pool.query('UPDATE app_workspaces SET blocked = $2 WHERE workspace_id = $1', [
            row.workspace_id,
            blocked,
          ])
        }
        return
      }
      computeChanged =
        canonicalJson(before?.compute_resources ?? {}) !==
        canonicalJson(after?.compute_resources ?? {})
    }
    await applyRuntime(row.workspace_id, row.agent, row.agent_runtime)
    await pool.query(
      'UPDATE app_workspaces SET runtime = $2, blocked = NULL WHERE workspace_id = $1',
      [row.workspace_id, JSON.stringify(row.agent_runtime)],
    )

    const workspace = await getWorkspace(row.workspace_id)
    if (workspace?.status !== 'running') return
    // A new agent type or compute shape takes a new pod; the rest reloads.
    const { rebuilt } = await reconcileWorkspacePod(row.workspace_id)
    if (rebuilt || computeChanged) {
      if (!rebuilt) await bumpWorkspaceSpec(row.workspace_id)
      await updateWorkspace(row.workspace_id, { status: 'starting' })
    } else {
      await notifyAgentReload(row.workspace_id, ['config', 'skills']).catch(() => false)
    }
  } finally {
    await client.query('COMMIT').catch(() => {})
    client.release()
  }
}

/**
 * Bring every workspace that is behind its agent up to date, where idle, and
 * every user's shared folders in line.
 */
export async function convergeAppWorkspaces(clientId?: string): Promise<void> {
  const { rows } = await pool.query(
    `${ROW_SQL}
      WHERE (wc.template_version <> t.latest_version OR aw.runtime <> a.runtime)
        AND ($1::text IS NULL OR aw.client_id = $1)`,
    [clientId ?? null],
  )
  for (const row of rows as AppWorkspaceRow[]) {
    try {
      await convergeWorkspace(row)
    } catch (e) {
      console.error(`[app-spec] converging workspace ${row.workspace_id} failed:`, e)
    }
  }
  // Folders change without waiting for a workspace to be idle, as they do
  // when granted by hand.
  try {
    await convergeAppFolders(clientId)
  } catch (e) {
    console.error('[app-spec] converging shared folders failed:', e)
  }
}

interface AgentStatus {
  agent: string
  template_version: number
  workspaces: number
  up_to_date: number
  blocked: number
}

/** Per agent of the spec: how many of its workspaces are up to date. */
export async function agentStatuses(clientId: string): Promise<AgentStatus[]> {
  const { rows } = await pool.query(
    `SELECT a.name AS agent, t.latest_version AS template_version,
            count(aw.workspace_id)::int AS workspaces,
            (count(aw.workspace_id) FILTER (
               WHERE wc.template_version = t.latest_version AND aw.runtime = a.runtime))::int AS up_to_date,
            (count(aw.workspace_id) FILTER (
               WHERE aw.blocked IS NOT NULL OR aw.folders_blocked IS NOT NULL))::int AS blocked
       FROM app_agents a
       JOIN templates t ON t.id = a.template_id
       LEFT JOIN app_workspaces aw ON aw.client_id = a.client_id AND aw.agent = a.name
       LEFT JOIN workspace_config wc ON wc.workspace_id = aw.workspace_id
      WHERE a.client_id = $1
      GROUP BY a.name, t.latest_version
      ORDER BY a.name`,
    [clientId],
  )
  return rows as AgentStatus[]
}
