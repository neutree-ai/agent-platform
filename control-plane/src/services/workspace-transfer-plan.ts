import type {
  ApiTransferPlan,
  TransferCopySelection,
  TransferItem,
  TransferUser,
} from '../../../internal/types/api'
import { getWorkspacePlacementEnv } from './db/environments'
import { pool } from './db/pool'
import type { User, Workspace } from './db/types'

// Planning a workspace transfer: everything the workspace has or points at,
// and what the transfer will do with each.
//
// The rule the plan applies is that nothing of the sender's may keep flowing
// to the recipient behind their back. The workspace's own content moves; a
// reference to something else the sender owns survives only if the recipient
// could use that thing anyway (they own it, it is public, or a team grants it
// to them). Anything else is detached, or — for private prompts and skills,
// if the sender opts in — copied into the recipient's account. Secrets
// (providers, credentials) are never copied.
//
// The plan is computed from live state every time it is shown and once more
// right before execution, so what runs is what the state is at that moment,
// not what it was when the transfer was requested.

interface ResourceRef {
  id: string
  name: string
}

/** Facts the executor needs beyond the user-facing plan. */
export interface TransferFacts {
  /** The workspace's template is private to the sender and gets baked in. */
  ejectTemplate: boolean
  /** The workspace's provider (after any eject) and whether the recipient can use it. */
  providerId: string | null
  providerUsable: boolean
  /** Prompts / skills referenced by the workspace that the recipient cannot use. */
  privatePrompts: ResourceRef[]
  privateSkills: ResourceRef[]
  /** Memory stores provisioned for this workspace, which move with it. */
  movedStoreIds: string[]
}

interface TransferPlanResult {
  plan: ApiTransferPlan
  facts: TransferFacts
}

// ── visibility ──────────────────────────────────────────────────────────────

// Every shareable resource follows the same rule — owner, public, or a team
// grant the user is a member of. The table / column names here are constants,
// never input.
const SHAREABLE = {
  prompt: {
    table: 'prompts',
    owner: 'user_id',
    grants: 'prompt_grants',
    fk: 'prompt_id',
    idType: 'text',
  },
  provider: {
    table: 'model_providers',
    owner: 'user_id',
    grants: 'provider_grants',
    fk: 'provider_id',
    idType: 'text',
  },
  template: {
    table: 'templates',
    owner: 'owner_id',
    grants: 'template_grants',
    fk: 'template_id',
    idType: 'text',
  },
  skill: {
    table: 'skills',
    owner: 'user_id',
    grants: 'skill_grants',
    fk: 'skill_id',
    idType: 'uuid',
  },
  environment: {
    table: 'environments',
    owner: 'user_id',
    grants: 'environment_grants',
    fk: 'environment_id',
    idType: 'text',
  },
} as const

/** The subset of `ids` that `userId` may use. */
export async function usableBy(
  kind: keyof typeof SHAREABLE,
  ids: string[],
  userId: string,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const s = SHAREABLE[kind]
  const { rows } = await pool.query(
    `SELECT r.id::text AS id FROM ${s.table} r
      WHERE r.id = ANY($1::${s.idType}[])
        AND (r.${s.owner} = $2
             OR r.visibility = 'public'
             OR EXISTS (SELECT 1 FROM ${s.grants} g
                          JOIN team_members tm ON tm.team_id = g.team_id AND tm.user_id = $2
                         WHERE g.${s.fk} = r.id))`,
    [ids, userId],
  )
  return new Set(rows.map((r: { id: string }) => r.id))
}

// ── slug ────────────────────────────────────────────────────────────────────

export async function slugTakenBy(userId: string, slug: string, exceptWorkspaceId: string) {
  const { rows } = await pool.query(
    'SELECT 1 FROM workspaces WHERE user_id = $1 AND slug = $2 AND id <> $3',
    [userId, slug, exceptWorkspaceId],
  )
  return rows.length > 0
}

/** `slug`, or `slug-2`, `slug-3`… — the first one `userId` does not have. */
export async function freeSlugFor(userId: string, slug: string, exceptWorkspaceId: string) {
  const { rows } = await pool.query(
    'SELECT slug FROM workspaces WHERE user_id = $1 AND slug LIKE $2 AND id <> $3',
    [userId, `${slug}%`, exceptWorkspaceId],
  )
  const taken = new Set(rows.map((r: { slug: string }) => r.slug))
  if (!taken.has(slug)) return slug
  for (let n = 2; ; n++) {
    if (!taken.has(`${slug}-${n}`)) return `${slug}-${n}`
  }
}

// ── plan ────────────────────────────────────────────────────────────────────

function toTransferUser(u: User): TransferUser {
  return { id: u.id, username: u.username, display_name: u.display_name }
}

function item(
  kind: TransferItem['kind'],
  action: TransferItem['action'],
  ref: { id?: string | null; name?: string | null; count?: number | null } = {},
): TransferItem {
  return { kind, action, id: ref.id ?? null, name: ref.name ?? null, count: ref.count ?? null }
}

/**
 * Plan transferring `workspace` from its owner to `to`.
 *
 * `copy` is the sender's selection of private prompts / skills to copy;
 * omitted, every one of them is offered as copied (the default the sender
 * starts from).
 */
export async function planTransfer(
  workspace: Workspace,
  from: User,
  to: User,
  copy?: TransferCopySelection,
): Promise<TransferPlanResult> {
  const ws = workspace.id
  const items: TransferItem[] = []

  // The workspace itself. Files and history are the part the sender most needs
  // to know about: they move exactly as they are, secrets on disk included.
  items.push(item('files', 'move'))
  const { rows: sessionCount } = await pool.query(
    'SELECT count(*)::int AS n FROM sessions WHERE workspace_id = $1',
    [ws],
  )
  items.push(item('sessions', 'move', { count: sessionCount[0].n }))

  const { rows: rawRows } = await pool.query(
    `SELECT wc.template_id, wc.provider_id, wc.prompt_id, wc.api_key, wc.mcp_config,
            COALESCE(wc.provider_id, tv.provider_id) AS resolved_provider_id,
            CASE WHEN wc.prompt_id IS NOT NULL THEN wc.prompt_id
                 WHEN COALESCE(wc.system_prompt, '') <> '' THEN NULL
                 ELSE tv.prompt_id END AS resolved_prompt_id,
            t.name AS template_name
       FROM workspace_config wc
       LEFT JOIN template_versions tv
              ON tv.template_id = wc.template_id AND tv.version = wc.template_version
       LEFT JOIN templates t ON t.id = wc.template_id
      WHERE wc.workspace_id = $1`,
    [ws],
  )
  const raw = rawRows[0] ?? {}

  // Template. A template the recipient can use stays linked, and whatever it
  // supplies (provider, prompt) is the template's business, exactly as for any
  // other user of it. A private one is baked in: its configuration becomes the
  // workspace's own, and what it supplied is then judged like the workspace's.
  let ejectTemplate = false
  if (raw.template_id) {
    const usable = await usableBy('template', [raw.template_id], to.id)
    ejectTemplate = !usable.has(raw.template_id)
    items.push(
      item('template', ejectTemplate ? 'eject' : 'keep', {
        id: raw.template_id,
        name: raw.template_name,
      }),
    )
  }
  const providerId: string | null = ejectTemplate ? raw.resolved_provider_id : raw.provider_id
  const workspacePromptId: string | null = ejectTemplate ? raw.resolved_prompt_id : raw.prompt_id

  // Provider. Never copied: it is the sender's key and the sender's bill.
  let providerUsable = true
  if (providerId) {
    providerUsable = (await usableBy('provider', [providerId], to.id)).has(providerId)
    const { rows } = await pool.query('SELECT name FROM model_providers WHERE id = $1', [
      providerId,
    ])
    items.push(
      item('provider', providerUsable ? 'keep' : 'replace', {
        id: providerId,
        name: rows[0]?.name,
      }),
    )
  } else if (raw.api_key) {
    items.push(item('inline_api_key', 'move'))
  }

  if (raw.mcp_config && raw.mcp_config !== '{}') {
    items.push(item('mcp_config', 'move'))
    items.push(item('mcp_oauth', 'notice'))
  }

  // Prompts: the workspace's own, and any its commands / schedules run.
  const { rows: promptRefs } = await pool.query(
    `SELECT DISTINCT p.id, p.name FROM prompts p
      WHERE p.id = $2
         OR p.id IN (SELECT prompt_id FROM workspace_commands WHERE workspace_id = $1)
         OR p.id IN (SELECT prompt_id FROM schedules WHERE workspace_id = $1)`,
    [ws, workspacePromptId],
  )
  const usablePrompts = await usableBy(
    'prompt',
    promptRefs.map((p: ResourceRef) => p.id),
    to.id,
  )
  const privatePrompts: ResourceRef[] = promptRefs.filter(
    (p: ResourceRef) => !usablePrompts.has(p.id),
  )

  // Skills mounted on the workspace.
  const { rows: skillRefs } = await pool.query(
    `SELECT s.id::text AS id, s.name FROM workspace_skills ws
       JOIN skills s ON s.id = ws.skill_id
      WHERE ws.workspace_id = $1`,
    [ws],
  )
  const usableSkills = await usableBy(
    'skill',
    skillRefs.map((s: ResourceRef) => s.id),
    to.id,
  )
  const privateSkills: ResourceRef[] = skillRefs.filter((s: ResourceRef) => !usableSkills.has(s.id))

  const copyPrompts = new Set(copy ? copy.prompts : privatePrompts.map((p) => p.id))
  const copySkills = new Set(copy ? copy.skills : privateSkills.map((s) => s.id))
  for (const p of promptRefs as ResourceRef[]) {
    const action = usablePrompts.has(p.id) ? 'keep' : copyPrompts.has(p.id) ? 'copy' : 'detach'
    items.push(item('prompt', action, p))
  }
  for (const s of skillRefs as ResourceRef[]) {
    const action = usableSkills.has(s.id) ? 'keep' : copySkills.has(s.id) ? 'copy' : 'detach'
    items.push(item('skill', action, s))
  }

  // Memory. The store provisioned for this workspace is its memory and moves
  // with it; any other store stays only if the recipient already owns it.
  // Memory stores have no sharing, so there is nothing else to check.
  const { rows: stores } = await pool.query(
    `SELECT s.id, s.name, s.owner_user_id, s.origin_workspace_id
       FROM workspace_memory_attachments a
       JOIN memory_stores s ON s.id = a.store_id
      WHERE a.workspace_id = $1`,
    [ws],
  )
  const movedStoreIds: string[] = []
  for (const s of stores) {
    if (s.origin_workspace_id === ws && s.owner_user_id === from.id) {
      movedStoreIds.push(s.id)
      items.push(item('memory_store', 'move', s))
    } else {
      items.push(item('memory_store', s.owner_user_id === to.id ? 'keep' : 'detach', s))
    }
  }

  // Where it runs. A private environment of the sender's is their hardware;
  // re-placing the workspace elsewhere is out of scope, so it blocks.
  const placement = await getWorkspacePlacementEnv(ws)
  if (placement && !placement.isBuiltin) {
    const usable = await usableBy('environment', [placement.environmentId], to.id)
    const { rows } = await pool.query('SELECT name FROM environments WHERE id = $1', [
      placement.environmentId,
    ])
    items.push(
      item('environment', usable.has(placement.environmentId) ? 'keep' : 'block', {
        id: placement.environmentId,
        name: rows[0]?.name,
      }),
    )
  }

  // Filesystem shares with the sender's other workspaces, both directions.
  const { rows: afs } = await pool.query(
    `SELECT DISTINCT s.id, s.name FROM afs_share_members m
       JOIN afs_shares s ON s.id = m.share_id
      WHERE (s.owner_workspace_id = $1 AND m.workspace_id <> $1)
         OR (m.workspace_id = $1 AND s.owner_workspace_id <> $1)`,
    [ws],
  )
  for (const s of afs) items.push(item('afs_share', 'remove', s))

  // Teamwork. A task this workspace coordinates is its work and moves with it
  // (minus the sender's other workspaces); membership in the sender's other
  // tasks ends.
  const { rows: tasks } = await pool.query(
    `SELECT t.id, t.name, (t.coordinator_workspace_id = $1) AS coordinated
       FROM teamwork_tasks t
      WHERE t.coordinator_workspace_id = $1
         OR t.id IN (SELECT task_id FROM teamwork_participants WHERE workspace_id = $1)`,
    [ws],
  )
  for (const t of tasks) {
    items.push(item('teamwork_task', t.coordinated ? 'move' : 'remove', t))
  }

  const { rows: counts } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM schedules WHERE workspace_id = $1) AS schedules,
       (SELECT count(*)::int FROM workspace_tag_assignments WHERE workspace_id = $1) AS tags,
       (SELECT count(*)::int FROM user_credential_workspaces WHERE workspace_id = $1) AS bindings,
       (SELECT count(*)::int FROM export_tokens
         WHERE workspace_id = $1 AND (expires_at IS NULL OR expires_at > now()))
     + (SELECT count(*)::int FROM session_export_tokens
         WHERE workspace_id = $1 AND expires_at > now()) AS links`,
    [ws],
  )
  const c = counts[0]
  if (c.schedules > 0) items.push(item('schedules', 'move', { count: c.schedules }))
  if (c.tags > 0) items.push(item('tag', 'remove', { count: c.tags }))
  if (c.bindings > 0) items.push(item('credential_binding', 'remove', { count: c.bindings }))
  if (c.links > 0) items.push(item('export_link', 'revoke', { count: c.links }))

  // Things the transfer does not change but either side should know.
  items.push(item('recipient_credentials', 'notice'))
  items.push(item('channel_route', 'notice'))
  if (workspace.slug) items.push(item('slug_reference', 'notice', { name: workspace.slug }))

  const slugConflict = workspace.slug ? await slugTakenBy(to.id, workspace.slug, ws) : false

  return {
    plan: {
      workspace: { id: ws, name: workspace.name, slug: workspace.slug },
      from_user: toTransferUser(from),
      to_user: toTransferUser(to),
      items,
      copyable: { prompts: privatePrompts, skills: privateSkills },
      blocked: items.some((i) => i.action === 'block'),
      slug_conflict: slugConflict,
      suggested_slug:
        slugConflict && workspace.slug ? await freeSlugFor(to.id, workspace.slug, ws) : null,
      provider_required: !providerUsable,
    },
    facts: {
      ejectTemplate,
      providerId,
      providerUsable,
      privatePrompts,
      privateSkills,
      movedStoreIds,
    },
  }
}
