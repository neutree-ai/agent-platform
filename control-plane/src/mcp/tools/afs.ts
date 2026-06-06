import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
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
  getAfsShareByName,
  listAfsShareMembers,
} from '../../services/db/afs-shares'
import { getWorkspace, resolveWorkspaceBySlug } from '../../services/db/workspaces'
import { textResult } from './shared'

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,47}$/

async function ensureLocalShare(workspaceId: string, name: string) {
  let share = await getAfsShareByName(workspaceId, name)
  if (share) return share
  await ensureDefaultFs()
  const dir = await createDir()
  share = await createAfsShare(workspaceId, name, dir.id, dir.accessKey)
  await mountAtWorkspace(workspaceId, dir.id, dir.accessKey, name, false)
  await addAfsShareMember(share.id, workspaceId, 'read_write')
  return share
}

export function registerAfsTools(server: McpServer, workspaceId: string) {
  server.registerTool(
    'share_folder',
    {
      title: 'Create / Ensure a Shared Folder',
      description: `Create a shared folder mounted at /mnt/afs/<name> in this workspace. Idempotent — re-calling with the same name returns the same folder.

**When to use** (prefer this over inlining file contents in another tool's prompt):
- The user asks to hand files off to another agent
- A task involves more than a couple of files, or any binary files (images, PDFs, docx)
- Files already exist in /workspace/... and inlining them would waste context

**Typical flow**:
1. share_folder(name="requirements") → {path: "/mnt/afs/requirements"}
2. Copy / write files into /mnt/afs/requirements/ with normal file tools (cp, Write, etc.)
3. (optional) grant_access(name="requirements", slug="<target>") when you want another agent to read it
4. (optional) call_agent(slug="<target>", prompt="...reference /mnt/afs/requirements/...") — only if the target should act immediately; otherwise the share just sits available

Steps 3–4 are optional. Use share_folder alone to park files for yourself or for a later handoff.

Name: lowercase letters/digits/hyphens, ≤48 chars, starts with letter or digit.`,
      inputSchema: z.object({
        name: z
          .string()
          .describe('Folder name, e.g. "testcase-2026-04". Mounts at /mnt/afs/<name>.'),
      }),
    },
    async ({ name }) => {
      try {
        if (!NAME_RE.test(name)) {
          return textResult(
            'Error: name must be lowercase letters/digits/hyphens (≤48 chars), starting with a letter or digit',
          )
        }
        await ensureLocalShare(workspaceId, name)
        return textResult(JSON.stringify({ path: `/mnt/afs/${name}` }))
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`)
      }
    },
  )

  server.registerTool(
    'grant_access',
    {
      title: 'Grant Another Agent Access to a Shared Folder',
      description: `Grant another agent access to a folder you previously created with share_folder. The target agent's sidecar mounts the folder at /mnt/afs/<name> (read-only by default) before this tool returns, so it is safe to call_agent the target immediately after — the mount is already in place.

**Important**: Credentials stay inside the platform. Do NOT include access keys or dir ids in any prompt. The target agent just sees /mnt/afs/<name> as a normal path.

Default readonly=true is correct for most hand-off cases. Only pass readonly=false if the target must write back — a full back-and-forth usually suggests a different protocol than a shared folder.`,
      inputSchema: z.object({
        name: z.string().describe('Folder name previously passed to share_folder.'),
        slug: z.string().describe('Target agent slug (same format as call_agent).'),
        readonly: z
          .boolean()
          .default(true)
          .describe('If true (default), target agent mounts read-only.'),
      }),
    },
    async ({ name, slug, readonly }) => {
      try {
        const caller = await getWorkspace(workspaceId)
        if (!caller) return textResult('Error: caller workspace not found')
        const target = await resolveWorkspaceBySlug(slug, caller.user_id)
        if (!target) return textResult(`Error: no agent found with slug "${slug}"`)
        if (target.id === workspaceId) return textResult('Error: cannot grant access to yourself')

        const share = await getAfsShareByName(workspaceId, name)
        if (!share) return textResult(`Error: no folder named "${name}" — call share_folder first`)

        await mountAtWorkspace(target.id, share.afs_dir_id, share.access_key, name, readonly)
        await addAfsShareMember(share.id, target.id, readonly ? 'read_only' : 'read_write')

        return textResult(JSON.stringify({ path: `/mnt/afs/${name}`, target: slug, readonly }))
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`)
      }
    },
  )

  server.registerTool(
    'unshare_from_all',
    {
      title: 'Revoke a Shared Folder',
      description:
        'Revoke a previously-shared folder. All members (including yourself and target agents) are force-unmounted and the underlying afs directory is destroyed.',
      inputSchema: z.object({
        name: z.string().describe('Folder name used when sharing.'),
      }),
    },
    async ({ name }) => {
      try {
        const share = await getAfsShareByName(workspaceId, name)
        if (!share) return textResult(`Error: no share named "${name}"`)

        const members = await listAfsShareMembers(share.id)
        await revokeDir(share.afs_dir_id, share.access_key)
        for (const m of members) {
          try {
            await unmountAtWorkspace(m.workspace_id, name)
          } catch {
            // Best-effort: mount may already be gone after revoke.
          }
        }
        await deleteAfsShare(share.id)
        return textResult(JSON.stringify({ revoked: name, members: members.length }))
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`)
      }
    },
  )
}
