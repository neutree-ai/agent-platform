import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../../lib/types'
import { canAccessWorkspace } from '../../lib/workspace-access'
import {
  ShareAccessError,
  ShareEnvironmentError,
  ShareNameConflictError,
  ensureShare,
  grantShare,
  grantShareToTeam,
  mountShareForTeam,
  removeShareMember,
  revokeShare,
  revokeShareFromTeam,
} from '../../services/afs-shares'
import {
  getAfsShareById,
  listAfsShareGrants,
  listAfsShareMemberDetails,
  listAfsShareMembers,
  listAfsSharesAvailableTo,
  listAfsSharesVisibleTo,
} from '../../services/db/afs-shares'
import { getWorkspace } from '../../services/db/workspaces'

const afsShares = new OpenAPIHono<AppEnv>()

const ErrorSchema = z.object({ error: z.string() })
const SuccessSchema = z.object({ success: z.boolean() })

const WorkspaceIdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
})
const ShareParam = WorkspaceIdParam.extend({
  shareId: z.string().openapi({ param: { name: 'shareId', in: 'path' } }),
})
const ShareMemberParam = ShareParam.extend({
  memberWorkspaceId: z.string().openapi({ param: { name: 'memberWorkspaceId', in: 'path' } }),
})
const ShareTeamParam = ShareParam.extend({
  teamId: z.string().openapi({ param: { name: 'teamId', in: 'path' } }),
})

const PermissionSchema = z.enum(['read_only', 'read_write'])
const MountNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,47}$/)
  .describe('Where the folder is mounted, /mnt/afs/<mount_name>.')

const AfsShareSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  owner_workspace_id: z.string(),
  afs_dir_id: z.string(),
  role: z.enum(['owner', 'member']),
  my_permission: PermissionSchema,
  mount_name: z.string().describe('Where this workspace has the folder: /mnt/afs/<mount_name>.'),
  source: z
    .enum(['direct', 'team'])
    .describe("'team': this workspace has the folder through a grant to a team."),
  owner_user_id: z.string(),
  owner_display_name: z.string(),
  other_member_count: z.number().describe("Workspaces other than the owner's that have it."),
  grant_count: z.number().describe('Teams the folder is granted to.'),
  created_at: z.string(),
})

const AfsShareMemberSchema = z.object({
  workspace_id: z.string(),
  permission: PermissionSchema,
  mounted_at: z.string(),
})

const AfsShareMemberDetailSchema = AfsShareMemberSchema.extend({
  source: z.enum(['direct', 'team']),
  mount_name: z.string(),
  workspace_name: z.string(),
  user_id: z.string(),
  user_display_name: z.string(),
})

const AfsShareGrantSchema = z.object({
  team_id: z.string(),
  team_name: z.string(),
  permission: PermissionSchema.describe('The highest permission team members can mount it at.'),
  granted_at: z.string(),
})

const AfsAvailableShareSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner_user_id: z.string(),
  owner_display_name: z.string(),
  ceiling: PermissionSchema.describe('The highest permission it can be mounted at.'),
  team_names: z.array(z.string()),
  created_at: z.string(),
})

const GrantTeamBodySchema = z.object({ permission: PermissionSchema })

const MountBodySchema = z.object({
  share_id: z.string(),
  permission: PermissionSchema.default('read_only'),
  mount_name: MountNameSchema.optional().describe(
    "Where to mount it, /mnt/afs/<mount_name>; the folder's own name when omitted.",
  ),
})

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d))

function summaryJson(s: Awaited<ReturnType<typeof listAfsSharesVisibleTo>>[number]) {
  return {
    id: s.id,
    name: s.name,
    owner_workspace_id: s.owner_workspace_id,
    afs_dir_id: s.afs_dir_id,
    role: s.role,
    my_permission: s.my_permission,
    mount_name: s.mount_name,
    source: s.source,
    owner_user_id: s.owner_user_id,
    owner_display_name: s.owner_display_name,
    other_member_count: s.other_member_count,
    grant_count: s.grant_count,
    created_at: iso(s.created_at),
  }
}

const CreateBodySchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,47}$/)
    .describe('Human-readable folder name; lowercase letters/digits/hyphens, ≤48 chars.'),
})

const GrantBodySchema = z.object({
  workspace_id: z.string().describe('Workspace to grant access to.'),
  readonly: z.boolean().default(true),
})

async function resolveCallerWorkspace(
  id: string,
  user: { sub: string; role: string },
): Promise<
  { ok: true; workspace: Awaited<ReturnType<typeof getWorkspace>> & object } | { ok: false }
> {
  const workspace = await getWorkspace(id)
  if (!workspace || !(await canAccessWorkspace(workspace, user))) return { ok: false }
  return { ok: true, workspace }
}

// ── GET /:id/afs/shares ─────────────────────────────────────────────────
afsShares.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/afs/shares',
    tags: ['afs'],
    summary: 'List shared folders visible to this workspace (owner or member).',
    security: [{ bearerAuth: [] }],
    request: { params: WorkspaceIdParam },
    responses: {
      200: {
        description: 'Shares',
        content: {
          'application/json': {
            schema: z.object({ shares: z.array(AfsShareSummarySchema) }),
          },
        },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const r = await resolveCallerWorkspace(id, c.get('user'))
    if (!r.ok) return c.json({ error: 'Workspace not found' }, 404)
    const shares = await listAfsSharesVisibleTo(id)
    return c.json(
      {
        shares: shares.map(summaryJson),
      },
      200,
    )
  },
)

// ── POST /:id/afs/shares — create + mount on self ──────────────────────
afsShares.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/afs/shares',
    tags: ['afs'],
    summary: 'Create a shared folder owned by this workspace. Idempotent on name.',
    security: [{ bearerAuth: [] }],
    request: {
      params: WorkspaceIdParam,
      body: { content: { 'application/json': { schema: CreateBodySchema } } },
    },
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: AfsShareSummarySchema } },
      },
      400: {
        description: 'Invalid name',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: 'A folder is already mounted at that name',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      502: {
        description: 'afs unavailable',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const r = await resolveCallerWorkspace(id, c.get('user'))
    if (!r.ok) return c.json({ error: 'Workspace not found' }, 404)
    const { name } = c.req.valid('json')

    try {
      // The owner's pod must be running: its folder is mounted before this returns.
      const share = await ensureShare(id, name, { mountNow: true })
      const created = (await listAfsSharesVisibleTo(id)).find((s) => s.id === share.id)!
      return c.json(summaryJson(created), 201)
    } catch (e) {
      if (e instanceof ShareNameConflictError) return c.json({ error: e.message }, 409)
      return c.json({ error: `afs: ${(e as Error).message}` }, 502)
    }
  },
)

// ── DELETE /:id/afs/shares/:shareId — revoke (owner only) ──────────────
afsShares.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}/afs/shares/{shareId}',
    tags: ['afs'],
    summary: 'Revoke a shared folder. Force-unmounts every member.',
    security: [{ bearerAuth: [] }],
    request: { params: ShareParam },
    responses: {
      200: {
        description: 'Revoked',
        content: { 'application/json': { schema: SuccessSchema } },
      },
      403: {
        description: 'Not owner',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const { id, shareId } = c.req.valid('param')
    const r = await resolveCallerWorkspace(id, c.get('user'))
    if (!r.ok) return c.json({ error: 'Workspace not found' }, 404)
    const share = await getAfsShareById(shareId)
    if (!share) return c.json({ error: 'Share not found' }, 404)
    if (share.owner_workspace_id !== id) return c.json({ error: 'Not owner' }, 403)

    await revokeShare(share)
    return c.json({ success: true }, 200)
  },
)

// ── GET /:id/afs/shares/:shareId/members ────────────────────────────────
afsShares.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/afs/shares/{shareId}/members',
    tags: ['afs'],
    summary:
      "List share members. The owner sees every member; a member sees the ones of its own owner's.",
    security: [{ bearerAuth: [] }],
    request: { params: ShareParam },
    responses: {
      200: {
        description: 'Members',
        content: {
          'application/json': {
            schema: z.object({ members: z.array(AfsShareMemberDetailSchema) }),
          },
        },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const { id, shareId } = c.req.valid('param')
    const r = await resolveCallerWorkspace(id, c.get('user'))
    if (!r.ok) return c.json({ error: 'Workspace not found' }, 404)
    const share = await getAfsShareById(shareId)
    if (!share) return c.json({ error: 'Share not found' }, 404)
    // Caller must be owner OR current member of this share.
    if (share.owner_workspace_id !== id) {
      const members = await listAfsShareMembers(share.id)
      if (!members.some((m) => m.workspace_id === id)) {
        return c.json({ error: 'Not a member' }, 404)
      }
    }
    // Another user's member doesn't get to see who else has the folder.
    const members = (await listAfsShareMemberDetails(share.id)).filter(
      (m) => share.owner_workspace_id === id || m.user_id === r.workspace.user_id,
    )
    return c.json(
      {
        members: members.map((m) => ({
          workspace_id: m.workspace_id,
          permission: m.permission,
          mounted_at: iso(m.mounted_at),
          source: m.source,
          mount_name: m.mount_name ?? share.name,
          workspace_name: m.workspace_name,
          user_id: m.user_id,
          user_display_name: m.user_display_name,
        })),
      },
      200,
    )
  },
)

// ── POST /:id/afs/shares/:shareId/members — grant ───────────────────────
afsShares.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/afs/shares/{shareId}/members',
    tags: ['afs'],
    summary: 'Grant another workspace access to this share. Owner only.',
    security: [{ bearerAuth: [] }],
    request: {
      params: ShareParam,
      body: { content: { 'application/json': { schema: GrantBodySchema } } },
    },
    responses: {
      201: {
        description: 'Granted',
        content: { 'application/json': { schema: AfsShareMemberSchema } },
      },
      400: {
        description: 'Target on a different environment',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      403: {
        description: 'Not owner',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      502: {
        description: 'afs mount failed',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const { id, shareId } = c.req.valid('param')
    const r = await resolveCallerWorkspace(id, c.get('user'))
    if (!r.ok) return c.json({ error: 'Workspace not found' }, 404)
    const share = await getAfsShareById(shareId)
    if (!share) return c.json({ error: 'Share not found' }, 404)
    if (share.owner_workspace_id !== id) return c.json({ error: 'Not owner' }, 403)

    const { workspace_id: targetId, readonly } = c.req.valid('json')
    const target = await getWorkspace(targetId)
    if (!target) return c.json({ error: 'Target workspace not found' }, 404)
    if (target.user_id !== r.workspace?.user_id) {
      // Keep the same scope rule as grant_access MCP tool: same-user only.
      return c.json({ error: 'Target workspace belongs to another user' }, 403)
    }
    try {
      // The target's pod must be running: the folder is mounted before this returns.
      await grantShare(share, targetId, readonly ? 'read_only' : 'read_write', { mountNow: true })
    } catch (e) {
      if (e instanceof ShareEnvironmentError) return c.json({ error: e.message }, 400)
      return c.json({ error: `afs mount failed: ${(e as Error).message}` }, 502)
    }

    return c.json(
      {
        workspace_id: targetId,
        permission: (readonly ? 'read_only' : 'read_write') as 'read_only' | 'read_write',
        mounted_at: new Date().toISOString(),
      },
      201,
    )
  },
)

// ── DELETE /:id/afs/shares/:shareId/members/:memberWorkspaceId ─────────
afsShares.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}/afs/shares/{shareId}/members/{memberWorkspaceId}',
    tags: ['afs'],
    summary:
      'Remove a member. Owner can remove any member; a member can remove themselves (leave).',
    security: [{ bearerAuth: [] }],
    request: { params: ShareMemberParam },
    responses: {
      200: {
        description: 'Removed',
        content: { 'application/json': { schema: SuccessSchema } },
      },
      403: {
        description: 'Forbidden',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const { id, shareId, memberWorkspaceId } = c.req.valid('param')
    const r = await resolveCallerWorkspace(id, c.get('user'))
    if (!r.ok) return c.json({ error: 'Workspace not found' }, 404)
    const share = await getAfsShareById(shareId)
    if (!share) return c.json({ error: 'Share not found' }, 404)
    const isOwner = share.owner_workspace_id === id
    const isSelfRemove = memberWorkspaceId === id
    if (!isOwner && !isSelfRemove) {
      return c.json({ error: 'Only owner can remove other members' }, 403)
    }
    if (isOwner && memberWorkspaceId === id) {
      // Owner "removing themselves" is meaningless — they still own the share.
      return c.json({ error: 'Owner cannot leave their own share; revoke it instead' }, 403)
    }

    const removed = await removeShareMember(share, memberWorkspaceId)
    return c.json({ success: removed }, 200)
  },
)

// ── Team grants ─────────────────────────────────────────────────────────
//
// Only the owner of the folder's workspace grants it to teams: sharing the
// workspace's data beyond it stays with the owner, as sharing the workspace
// itself does, and not with whoever the workspace is shared with.

/** The share, when the caller owns the workspace that owns it. */
async function resolveOwnedShare(
  id: string,
  shareId: string,
  user: { sub: string; role: string },
): Promise<
  | { ok: true; share: NonNullable<Awaited<ReturnType<typeof getAfsShareById>>> }
  | { ok: false; status: 403 | 404; error: string }
> {
  const r = await resolveCallerWorkspace(id, user)
  if (!r.ok) return { ok: false, status: 404, error: 'Workspace not found' }
  const share = await getAfsShareById(shareId)
  if (!share) return { ok: false, status: 404, error: 'Share not found' }
  if (share.owner_workspace_id !== id) return { ok: false, status: 403, error: 'Not owner' }
  if (r.workspace.user_id !== user.sub) {
    return { ok: false, status: 403, error: "Only the workspace's owner can share its folders" }
  }
  return { ok: true, share }
}

// ── GET /:id/afs/shares/:shareId/grants ─────────────────────────────────
afsShares.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/afs/shares/{shareId}/grants',
    tags: ['afs'],
    summary: 'List the teams a folder is granted to. Owner only.',
    security: [{ bearerAuth: [] }],
    request: { params: ShareParam },
    responses: {
      200: {
        description: 'Grants',
        content: {
          'application/json': { schema: z.object({ grants: z.array(AfsShareGrantSchema) }) },
        },
      },
      403: { description: 'Not owner', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id, shareId } = c.req.valid('param')
    const r = await resolveOwnedShare(id, shareId, c.get('user'))
    if (!r.ok) return c.json({ error: r.error }, r.status)
    const grants = await listAfsShareGrants(r.share.id)
    return c.json(
      {
        grants: grants.map((g) => ({
          team_id: g.team_id,
          team_name: g.team_name,
          permission: g.permission,
          granted_at: iso(g.granted_at),
        })),
      },
      200,
    )
  },
)

// ── PUT /:id/afs/shares/:shareId/grants/:teamId — grant to a team ───────
afsShares.openapi(
  createRoute({
    method: 'put',
    path: '/{id}/afs/shares/{shareId}/grants/{teamId}',
    tags: ['afs'],
    summary:
      "Grant a folder to a team the owner is in, or change the grant's permission. Members of the team can then mount it in their workspaces, at up to that permission; lowering it takes effect on their mounts.",
    security: [{ bearerAuth: [] }],
    request: {
      params: ShareTeamParam,
      body: { content: { 'application/json': { schema: GrantTeamBodySchema } } },
    },
    responses: {
      200: {
        description: 'Granted',
        content: { 'application/json': { schema: SuccessSchema } },
      },
      403: {
        description: 'Not owner, or not in the team',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id, shareId, teamId } = c.req.valid('param')
    const user = c.get('user')
    const r = await resolveOwnedShare(id, shareId, user)
    if (!r.ok) return c.json({ error: r.error }, r.status)
    const { permission } = c.req.valid('json')
    try {
      await grantShareToTeam(r.share, teamId, permission, user.sub)
    } catch (e) {
      if (e instanceof ShareAccessError) return c.json({ error: e.message }, 403)
      throw e
    }
    return c.json({ success: true }, 200)
  },
)

// ── DELETE /:id/afs/shares/:shareId/grants/:teamId ──────────────────────
afsShares.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}/afs/shares/{shareId}/grants/{teamId}',
    tags: ['afs'],
    summary:
      "Take a folder's grant from a team. Mounts no other grant allows are unmounted. Owner only.",
    security: [{ bearerAuth: [] }],
    request: { params: ShareTeamParam },
    responses: {
      200: {
        description: 'Revoked',
        content: { 'application/json': { schema: SuccessSchema } },
      },
      403: { description: 'Not owner', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id, shareId, teamId } = c.req.valid('param')
    const r = await resolveOwnedShare(id, shareId, c.get('user'))
    if (!r.ok) return c.json({ error: r.error }, r.status)
    const removed = await revokeShareFromTeam(r.share, teamId)
    if (!removed) return c.json({ error: 'Grant not found' }, 404)
    return c.json({ success: true }, 200)
  },
)

// ── GET /:id/afs/available — folders this workspace can mount ───────────
afsShares.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/afs/available',
    tags: ['afs'],
    summary:
      "Other users' folders granted to a team the workspace's owner is in, that the workspace doesn't have yet.",
    security: [{ bearerAuth: [] }],
    request: { params: WorkspaceIdParam },
    responses: {
      200: {
        description: 'Folders',
        content: {
          'application/json': { schema: z.object({ shares: z.array(AfsAvailableShareSchema) }) },
        },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const r = await resolveCallerWorkspace(id, c.get('user'))
    if (!r.ok) return c.json({ error: 'Workspace not found' }, 404)
    const shares = await listAfsSharesAvailableTo(id)
    return c.json(
      {
        shares: shares.map((s) => ({
          id: s.id,
          name: s.name,
          owner_user_id: s.owner_user_id,
          owner_display_name: s.owner_display_name,
          ceiling: s.ceiling,
          team_names: s.team_names,
          created_at: iso(s.created_at),
        })),
      },
      200,
    )
  },
)

// ── POST /:id/afs/mounts — mount a folder granted to a team ─────────────
afsShares.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/afs/mounts',
    tags: ['afs'],
    summary:
      "Mount another user's folder, granted to a team the workspace's owner is in, or change the permission of such a mount. A running workspace mounts it right away; a stopped one when it starts. Leave it with DELETE /{id}/afs/shares/{shareId}/members/{id}.",
    security: [{ bearerAuth: [] }],
    request: {
      params: WorkspaceIdParam,
      body: { content: { 'application/json': { schema: MountBodySchema } } },
    },
    responses: {
      201: {
        description: 'Mounted',
        content: {
          'application/json': {
            schema: z.object({
              share_id: z.string(),
              permission: PermissionSchema,
              mount_name: z.string(),
            }),
          },
        },
      },
      400: {
        description: 'Workspace on another environment',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      403: {
        description: 'Not granted, or not at that permission',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
      409: {
        description: 'A folder is already mounted at that name',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      502: {
        description: 'afs mount failed',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const r = await resolveCallerWorkspace(id, c.get('user'))
    if (!r.ok) return c.json({ error: 'Workspace not found' }, 404)
    const { share_id, permission, mount_name } = c.req.valid('json')
    const share = await getAfsShareById(share_id)
    if (!share) return c.json({ error: 'Share not found' }, 404)
    const owner = await getWorkspace(share.owner_workspace_id)
    if (!owner || owner.user_id === r.workspace.user_id) {
      // A user's own folders are granted to their workspaces directly.
      return c.json({ error: 'Share not found' }, 404)
    }
    try {
      const mounted = await mountShareForTeam(share, r.workspace, permission, mount_name, {
        mountNow: r.workspace.status === 'running',
      })
      return c.json({ share_id: share.id, permission, mount_name: mounted.mount_name }, 201)
    } catch (e) {
      if (e instanceof ShareAccessError) return c.json({ error: e.message }, 403)
      if (e instanceof ShareEnvironmentError) return c.json({ error: e.message }, 400)
      if (e instanceof ShareNameConflictError) return c.json({ error: e.message }, 409)
      return c.json({ error: `afs mount failed: ${(e as Error).message}` }, 502)
    }
  },
)

export default afsShares
