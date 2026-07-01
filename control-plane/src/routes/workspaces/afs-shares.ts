import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../../lib/types'
import {
  afsEnvForWorkspace,
  createDir,
  ensureDefaultFs,
  mountAtWorkspace,
  revokeDir,
  unmountAtWorkspace,
} from '../../services/afs'
import {
  addAfsShareMember,
  createAfsShare,
  deleteAfsShare,
  getAfsShareById,
  getAfsShareByName,
  listAfsShareMembers,
  listAfsSharesVisibleTo,
  removeAfsShareMember,
} from '../../services/db/afs-shares'
import { getWorkspace } from '../../services/db/workspaces'
import { canManage } from './_shared'

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

const AfsShareSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  owner_workspace_id: z.string(),
  afs_dir_id: z.string(),
  role: z.enum(['owner', 'member']),
  my_permission: z.enum(['read_only', 'read_write']),
  created_at: z.string(),
})

const AfsShareMemberSchema = z.object({
  workspace_id: z.string(),
  permission: z.enum(['read_only', 'read_write']),
  mounted_at: z.string(),
})

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
  if (!workspace || !canManage(workspace, user)) return { ok: false }
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
        shares: shares.map((s) => ({
          id: s.id,
          name: s.name,
          owner_workspace_id: s.owner_workspace_id,
          afs_dir_id: s.afs_dir_id,
          role: s.role,
          my_permission: s.my_permission,
          created_at:
            s.created_at instanceof Date ? s.created_at.toISOString() : String(s.created_at),
        })),
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
      let share = await getAfsShareByName(id, name)
      if (!share) {
        const afsEnv = await afsEnvForWorkspace(id)
        await ensureDefaultFs(afsEnv)
        const dir = await createDir(afsEnv)
        share = await createAfsShare(id, name, dir.id, dir.accessKey)
        await mountAtWorkspace(afsEnv, id, dir.id, dir.accessKey, name, false)
        await addAfsShareMember(share.id, id, 'read_write')
      }
      return c.json(
        {
          id: share.id,
          name: share.name,
          owner_workspace_id: share.owner_workspace_id,
          afs_dir_id: share.afs_dir_id,
          role: 'owner' as const,
          my_permission: 'read_write' as const,
          created_at:
            share.created_at instanceof Date
              ? share.created_at.toISOString()
              : String(share.created_at),
        },
        201,
      )
    } catch (e) {
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

    const afsEnv = await afsEnvForWorkspace(id)
    const members = await listAfsShareMembers(share.id)
    try {
      await revokeDir(afsEnv, share.afs_dir_id, share.access_key)
    } catch {
      // Best-effort: still clean up DB + local mounts below.
    }
    for (const m of members) {
      try {
        await unmountAtWorkspace(afsEnv, m.workspace_id, share.name)
      } catch {
        // Mount may already be gone after revoke.
      }
    }
    await deleteAfsShare(share.id)
    return c.json({ success: true }, 200)
  },
)

// ── GET /:id/afs/shares/:shareId/members ────────────────────────────────
afsShares.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/afs/shares/{shareId}/members',
    tags: ['afs'],
    summary: 'List share members.',
    security: [{ bearerAuth: [] }],
    request: { params: ShareParam },
    responses: {
      200: {
        description: 'Members',
        content: {
          'application/json': {
            schema: z.object({ members: z.array(AfsShareMemberSchema) }),
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
    const members = await listAfsShareMembers(share.id)
    return c.json(
      {
        members: members.map((m) => ({
          workspace_id: m.workspace_id,
          permission: m.permission,
          mounted_at:
            m.mounted_at instanceof Date ? m.mounted_at.toISOString() : String(m.mounted_at),
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
    // afs sharing scope is one environment: a share's dir + storage live in the
    // owner's environment, so a member on a different environment could never
    // mount it. Reject cross-environment grants with a clear reason.
    const afsEnv = await afsEnvForWorkspace(id)
    const targetEnv = await afsEnvForWorkspace(targetId)
    if (targetEnv.environmentId !== afsEnv.environmentId) {
      return c.json({ error: 'Target workspace is on a different environment' }, 400)
    }

    try {
      // If target is already a member, re-mount with the (possibly changed)
      // permission. afs-fuse's Mount RPC rejects duplicate mountpoints, so
      // we unmount first.
      const existing = await listAfsShareMembers(share.id)
      if (existing.some((m) => m.workspace_id === targetId)) {
        try {
          await unmountAtWorkspace(afsEnv, targetId, share.name)
        } catch {
          // Best-effort — continue even if stale unmount fails.
        }
      }
      await mountAtWorkspace(
        afsEnv,
        targetId,
        share.afs_dir_id,
        share.access_key,
        share.name,
        readonly,
      )
      await addAfsShareMember(share.id, targetId, readonly ? 'read_only' : 'read_write')
    } catch (e) {
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

    const removed = await removeAfsShareMember(share.id, memberWorkspaceId)
    if (removed) {
      try {
        await unmountAtWorkspace(await afsEnvForWorkspace(id), memberWorkspaceId, share.name)
      } catch {
        // Best-effort.
      }
    }
    return c.json({ success: removed }, 200)
  },
)

export default afsShares
