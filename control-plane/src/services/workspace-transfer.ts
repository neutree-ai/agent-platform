import type { PoolClient } from 'pg'
import type { ApiTransferPlan, TransferCopySelection } from '../../../internal/types/api'
import { interruptAllSessions } from '../routes/workspaces/_shared'
import { generateId, pool } from './db/pool'
import { resetAllSessionsIdle } from './db/sessions'
import { ensurePlatformToken } from './db/shares'
import type { User, Workspace } from './db/types'
import { getUser } from './db/users'
import { transitionTransfer } from './db/workspace-transfers'
import { getWorkspace, updateWorkspace } from './db/workspaces'
import { notify } from './notifications'
import { bumpWorkspaceSpec, setDesiredPhase } from './placement'
import {
  scsDeleteSkill,
  scsUploadSkill,
  skillsContentFetch,
  skillsContentUrl,
} from './skills-content'
import { drainBeforeTransfer } from './usage/teardown'
import { type TransferFacts, planTransfer, slugTakenBy, usableBy } from './workspace-transfer-plan'

// Executing a workspace transfer.
//
// Shared by the recipient's accept and the admin transfer; the only difference
// is who supplies the recipient's inputs. The steps:
//
//   1. Re-plan from live state and refuse on anything the plan cannot resolve.
//   2. Interrupt the running agent and collect its outstanding usage, so what
//      the sender ran is billed to the sender.
//   3. Copy the selected private skills into the recipient's account. Skills
//      live in skills-content-service, so this cannot join the transaction.
//   4. One transaction: every reference rewrite the plan calls for, the owner
//      flip, and the transfer row's completion.
//   5. Replace a running workspace's pod, so no process that started with the
//      sender's credentials in its environment survives the handover.
//
// Nothing on the workspace's volume is touched: files, including whatever the
// agent keeps in its home directory, move exactly as they are. The sender is
// told so before they start the transfer.

/** A reason the transfer cannot run as asked; maps to a 4xx. */
export class TransferRejected extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 409,
  ) {
    super(message)
    this.name = 'TransferRejected'
  }
}

interface TransferInputs {
  /** Required when the recipient already has a workspace with this slug. */
  slug?: string
  /**
   * The recipient's provider, required when they cannot use the current one —
   * except for an admin transfer, which may leave the workspace without one.
   */
  providerId?: string
  copy: TransferCopySelection
}

/** Validate a transfer can start at all, before any plan is shown or saved. */
export function assertTransferable(workspace: Workspace, to: User): void {
  if (workspace.is_system) throw new TransferRejected('System workspaces cannot be transferred')
  if (workspace.status === 'deleting') throw new TransferRejected('Workspace is being deleted')
  if (to.id === workspace.user_id) {
    throw new TransferRejected('The workspace already belongs to this user', 400)
  }
  if (to.role === 'system') throw new TransferRejected('Cannot transfer to a system account', 400)
}

/**
 * Carry out transfer `transferId`, which must be in status `executing`.
 * On any failure before the commit, the row returns to `onFailure` with the
 * error recorded; after the commit the transfer stands, and follow-up steps
 * only log.
 */
export async function executeTransfer(args: {
  transferId: string
  workspaceId: string
  fromUserId: string
  toUserId: string
  inputs: TransferInputs
  /** Where the row goes if execution fails: back to `pending` for a retryable accept. */
  onFailure: 'pending' | 'failed'
  allowNoProvider: boolean
  force?: boolean
}): Promise<ApiTransferPlan> {
  const { transferId, inputs } = args
  const copiedSkills = new Map<string, string>()
  try {
    const workspace = await getWorkspace(args.workspaceId)
    if (!workspace) throw new TransferRejected('Workspace not found', 404)
    if (workspace.user_id !== args.fromUserId) {
      throw new TransferRejected('The workspace has changed owner since the transfer was requested')
    }
    const [from, to] = await Promise.all([getUser(args.fromUserId), getUser(args.toUserId)])
    if (!from || !to) throw new TransferRejected('User not found', 404)
    assertTransferable(workspace, to)

    const { plan, facts } = await planTransfer(workspace, from, to, inputs.copy)
    const slug = await resolveSlug(workspace, to, plan, inputs.slug)
    const providerId = await resolveProvider(facts, to, inputs.providerId, args.allowNoProvider)
    if (plan.blocked) {
      throw new TransferRejected(
        "The workspace runs on a private environment of the sender's that the recipient cannot use",
      )
    }

    // Stop whatever the agent is doing and settle its account under the sender.
    await interruptAllSessions(workspace, 'Transfer')
    await drainBeforeTransfer(workspace, Date.now(), args.force ?? false)

    const copySkills = facts.privateSkills.filter((s) => inputs.copy.skills.includes(s.id))
    for (const s of copySkills) {
      const copied = await copySkill(s.id, to.id)
      if (copied) copiedSkills.set(s.id, copied)
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await rewriteReferences(client, {
        workspace,
        from,
        to,
        facts,
        providerId,
        copyPrompts: new Set(inputs.copy.prompts),
        copiedSkills,
      })
      const { rowCount } = await client.query(
        'UPDATE workspaces SET user_id = $2, slug = $3 WHERE id = $1 AND user_id = $4',
        [workspace.id, to.id, slug, from.id],
      )
      if (!rowCount) throw new TransferRejected('The workspace has changed owner meanwhile')
      await client.query(
        `UPDATE workspace_transfers
            SET status = 'completed', manifest = $2, error = NULL, resolved_at = now()
          WHERE id = $1`,
        [transferId, JSON.stringify(plan)],
      )
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }

    await afterTransfer(workspace, from, to)
    return plan
  } catch (e) {
    for (const skillId of copiedSkills.values()) {
      await scsDeleteSkill(skillId).catch(() => {})
    }
    const message = e instanceof Error ? e.message : String(e)
    await transitionTransfer(transferId, 'executing', args.onFailure, { error: message })
    throw e
  }
}

async function resolveSlug(
  workspace: Workspace,
  to: User,
  plan: ApiTransferPlan,
  requested: string | undefined,
): Promise<string | null> {
  if (requested && requested !== workspace.slug) {
    if (await slugTakenBy(to.id, requested, workspace.id)) {
      throw new TransferRejected(`The recipient already has a workspace with slug "${requested}"`)
    }
    return requested
  }
  if (plan.slug_conflict) {
    throw new TransferRejected(
      `The recipient already has a workspace with slug "${workspace.slug}"; choose another`,
    )
  }
  return workspace.slug
}

async function resolveProvider(
  facts: TransferFacts,
  to: User,
  requested: string | undefined,
  allowNone: boolean,
): Promise<string | null | undefined> {
  if (requested) {
    if (!(await usableBy('provider', [requested], to.id)).has(requested)) {
      throw new TransferRejected('The recipient cannot use the chosen provider', 400)
    }
    return requested
  }
  if (facts.providerUsable) return undefined // keep as is
  if (allowNone) return null
  throw new TransferRejected('Choose a provider for the workspace', 400)
}

/**
 * Copy a skill's active package into `toUserId`'s account as a new private
 * skill. Returns the new id, or null when the skill has nothing published to
 * copy (it could not have been loaded by the workspace either).
 *
 * Upload is an upsert on (owner, name), so the copy takes a name the
 * recipient does not have yet — otherwise it would silently overwrite one of
 * their skills.
 */
async function copySkill(skillId: string, toUserId: string): Promise<string | null> {
  const { rows } = await pool.query(
    'SELECT name, description, category FROM skills WHERE id = $1',
    [skillId],
  )
  if (!rows[0]) return null
  const name = await freeName('skills', toUserId, rows[0].name, (n, i) => `${n}-${i}`)

  const fetched = await skillsContentFetch(skillsContentUrl(skillId, '/package'))
  if (!fetched.ok) throw new Error(`Could not read skill "${rows[0].name}": ${fetched.error}`)
  if (fetched.response.status === 404) return null
  if (!fetched.response.ok || !fetched.response.body) {
    throw new Error(`Could not read skill "${rows[0].name}": upstream ${fetched.response.status}`)
  }
  const length = Number(fetched.response.headers.get('Content-Length') || 0)
  const result = await scsUploadSkill({
    meta: {
      user_id: toUserId,
      name,
      description: rows[0].description,
      visibility: 'private',
      category: rows[0].category,
    },
    body: fetched.response.body,
    contentLength: length || undefined,
  })
  if (!result.ok) throw new Error(`Could not copy skill "${rows[0].name}": ${result.error}`)
  return result.value.skill.id
}

/** The first of `base`, `format(base, 2)`, `format(base, 3)`… that `userId` has no row named. */
async function freeName(
  table: 'skills' | 'prompts',
  userId: string,
  base: string,
  format: (base: string, n: number) => string,
  client: Pick<PoolClient, 'query'> = pool,
): Promise<string> {
  const { rows } = await client.query(`SELECT name FROM ${table} WHERE user_id = $1`, [userId])
  const taken = new Set(rows.map((r: { name: string }) => r.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = format(base, n)
    if (!taken.has(candidate)) return candidate
  }
}

/** Every rewrite the plan calls for, inside the transfer's transaction. */
async function rewriteReferences(
  client: PoolClient,
  ctx: {
    workspace: Workspace
    from: User
    to: User
    facts: TransferFacts
    providerId: string | null | undefined
    copyPrompts: Set<string>
    copiedSkills: Map<string, string>
  },
): Promise<void> {
  const ws = ctx.workspace.id
  const { facts } = ctx

  // Bake a private template in: take each field the template supplies, the same
  // way getWorkspaceConfig resolves it, and make it the workspace's own. The
  // connection fields (provider_type / base_url / api_key) are left alone — a
  // template supplies them only through its provider, which the provider step
  // below handles, and resolving them here would copy that provider's key
  // into the workspace row.
  if (facts.ejectTemplate) {
    await client.query(
      `UPDATE workspace_config wc
          SET provider_id = COALESCE(wc.provider_id, tv.provider_id),
              prompt_id = CASE WHEN wc.prompt_id IS NOT NULL THEN wc.prompt_id
                               WHEN COALESCE(wc.system_prompt, '') <> '' THEN NULL
                               ELSE tv.prompt_id END,
              agent_type = COALESCE(NULLIF(wc.agent_type, ''), tv.agent_type),
              model = COALESCE(NULLIF(wc.model, ''), tv.model),
              small_model = COALESCE(NULLIF(wc.small_model, ''), tv.small_model),
              system_prompt = COALESCE(NULLIF(wc.system_prompt, ''), tv.system_prompt),
              mcp_config = COALESCE(NULLIF(wc.mcp_config, '{}'), tv.mcp_config::text, '{}'),
              agent_settings = COALESCE(NULLIF(wc.agent_settings, '{}'), tv.agent_settings::text, '{}'),
              compute_resources = COALESCE(wc.compute_resources, tv.compute_resources),
              updated_at = now()
         FROM template_versions tv
        WHERE wc.workspace_id = $1
          AND tv.template_id = wc.template_id AND tv.version = wc.template_version`,
      [ws],
    )
    await client.query(
      `UPDATE workspace_config SET template_id = NULL, template_version = NULL, updated_at = now()
        WHERE workspace_id = $1`,
      [ws],
    )
    // Template-origin rows are replaced on each template sync; with no template
    // left to sync from, they are ordinary rows of the workspace now.
    await client.query(
      `UPDATE workspace_commands SET origin = 'local' WHERE workspace_id = $1 AND origin = 'template'`,
      [ws],
    )
    await client.query(
      `UPDATE schedules SET origin = 'local' WHERE workspace_id = $1 AND origin = 'template'`,
      [ws],
    )
  }

  if (ctx.providerId !== undefined) {
    await client.query(
      'UPDATE workspace_config SET provider_id = $2, updated_at = now() WHERE workspace_id = $1',
      [ws, ctx.providerId],
    )
  }

  // Private prompts: point every reference at a copy, or drop it.
  for (const p of facts.privatePrompts) {
    let replacement: string | null = null
    if (ctx.copyPrompts.has(p.id)) {
      const { rows } = await client.query('SELECT content FROM prompts WHERE id = $1', [p.id])
      const name = await freeName('prompts', ctx.to.id, p.name, (n, i) => `${n} (${i})`, client)
      replacement = generateId()
      await client.query(
        `INSERT INTO prompts (id, user_id, name, content, visibility, is_public, current_version)
         VALUES ($1, $2, $3, $4, 'private', false, 1)`,
        [replacement, ctx.to.id, name, rows[0]?.content ?? ''],
      )
      await client.query(
        'INSERT INTO prompt_versions (id, prompt_id, version, content) VALUES ($1, $2, 1, $3)',
        [generateId(), replacement, rows[0]?.content ?? ''],
      )
    }
    for (const table of ['workspace_config', 'workspace_commands', 'schedules']) {
      await client.query(
        `UPDATE ${table} SET prompt_id = $3 WHERE workspace_id = $1 AND prompt_id = $2`,
        [ws, p.id, replacement],
      )
    }
  }

  // Private skills: remount the copy, or unmount.
  for (const s of facts.privateSkills) {
    const copied = ctx.copiedSkills.get(s.id)
    if (copied) {
      await client.query(
        'UPDATE workspace_skills SET skill_id = $3 WHERE workspace_id = $1 AND skill_id = $2',
        [ws, s.id, copied],
      )
    } else {
      await client.query('DELETE FROM workspace_skills WHERE workspace_id = $1 AND skill_id = $2', [
        ws,
        s.id,
      ])
    }
  }

  // Memory. The workspace's own store changes owner and leaves the sender's
  // other workspaces; any store the recipient does not own is detached.
  if (facts.movedStoreIds.length > 0) {
    await client.query('UPDATE memory_stores SET owner_user_id = $2 WHERE id = ANY($1)', [
      facts.movedStoreIds,
      ctx.to.id,
    ])
    await client.query(
      'DELETE FROM workspace_memory_attachments WHERE store_id = ANY($1) AND workspace_id <> $2',
      [facts.movedStoreIds, ws],
    )
  }
  await client.query(
    `DELETE FROM workspace_memory_attachments a
      USING memory_stores s
      WHERE a.store_id = s.id AND a.workspace_id = $1 AND s.owner_user_id <> $2`,
    [ws, ctx.to.id],
  )

  // Filesystem shares with other workspaces, in both directions.
  await client.query(
    `DELETE FROM afs_share_members m
      USING afs_shares s
      WHERE s.id = m.share_id
        AND ((s.owner_workspace_id = $1 AND m.workspace_id <> $1)
          OR (m.workspace_id = $1 AND s.owner_workspace_id <> $1))`,
    [ws],
  )

  // Teamwork: tasks this workspace coordinates go with it, without the
  // sender's other workspaces; its seats in other tasks are given up.
  await client.query(
    `DELETE FROM teamwork_participants p
      USING teamwork_tasks t
      WHERE t.id = p.task_id
        AND ((t.coordinator_workspace_id = $1 AND p.workspace_id <> $1)
          OR (p.workspace_id = $1 AND t.coordinator_workspace_id <> $1))`,
    [ws],
  )
  await client.query(
    'UPDATE teamwork_tasks SET owner_user_id = $2, updated_at = now() WHERE coordinator_workspace_id = $1',
    [ws, ctx.to.id],
  )

  // The sender's per-user links to the workspace.
  await client.query('DELETE FROM workspace_tag_assignments WHERE workspace_id = $1', [ws])
  await client.query('DELETE FROM user_credential_workspaces WHERE workspace_id = $1', [ws])

  // Public links the sender handed out would otherwise keep serving the
  // recipient's files and sessions.
  await client.query('DELETE FROM export_tokens WHERE workspace_id = $1', [ws])
  await client.query('DELETE FROM session_export_tokens WHERE workspace_id = $1', [ws])

  // Schedules run as their user (the scheduler presents that user's platform
  // token), so they follow the owner. Commands' user_id is only the author.
  await client.query('UPDATE schedules SET user_id = $2 WHERE workspace_id = $1', [ws, ctx.to.id])
  await client.query('UPDATE workspace_commands SET user_id = $2 WHERE workspace_id = $1', [
    ws,
    ctx.to.id,
  ])
}

/**
 * After the commit: best-effort follow-ups. The transfer stands whatever
 * happens here, so failures are logged, not thrown.
 */
async function afterTransfer(workspace: Workspace, from: User, to: User): Promise<void> {
  // Schedules now fire as the recipient, with the recipient's platform token.
  await ensurePlatformToken(to.id).catch((e) =>
    console.warn(`[transfer] ensurePlatformToken user=${to.id}:`, e?.message ?? e),
  )

  // A running pod was started with the sender's credentials in its process
  // environment. Replace it (same mechanism as the restart route) so the
  // agent comes back up as the recipient's. A stopped workspace has no
  // process to replace; its next start is already the recipient's. A pod that
  // was still starting may have fetched its config before the flip, so it is
  // replaced too.
  if (workspace.status === 'running' || workspace.status === 'starting') {
    try {
      await bumpWorkspaceSpec(workspace.id)
      await setDesiredPhase(workspace.id, 'running')
      await resetAllSessionsIdle(workspace.id)
      await updateWorkspace(workspace.id, { status: 'starting' })
    } catch (e: any) {
      console.error(`[transfer] pod replacement ws=${workspace.id} failed:`, e?.message ?? e)
    }
  }

  const webBase = (process.env.WEB_PUBLIC_URL || '').replace(/\/$/, '')
  await notify({
    eventType: 'workspace.transferred',
    payload: {
      title: `Workspace received: ${workspace.name}`,
      body: `**${from.display_name}** transferred the workspace **${workspace.name}** to you.`,
      type: 'success',
      url: webBase ? `${webBase}/w/${workspace.id}` : undefined,
      metadata: { workspace_id: workspace.id },
    },
    targetUserIds: [to.id],
  }).catch((e) => console.warn('[transfer] notify recipient failed:', e?.message ?? e))
  await notify({
    eventType: 'workspace.transferred',
    payload: {
      title: `Workspace transferred: ${workspace.name}`,
      body: `The workspace **${workspace.name}** now belongs to **${to.display_name}**.`,
      type: 'info',
      metadata: { workspace_id: workspace.id },
    },
    targetUserIds: [from.id],
  }).catch((e) => console.warn('[transfer] notify sender failed:', e?.message ?? e))
}
