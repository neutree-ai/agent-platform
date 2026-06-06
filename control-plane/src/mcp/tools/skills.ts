import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getWorkspaceAddress } from '../../lib/workspace-address'
import { getWorkspace } from '../../services/db/workspaces'
import { skillRepo, skillsService } from '../../services/skills-composition'
import { textResult } from './shared'

export function registerSkillsTools(server: McpServer, workspaceId: string) {
  async function getAgentAddress(): Promise<string> {
    const ws = await getWorkspace(workspaceId)
    if (!ws) throw new Error('Workspace not found')
    if (ws.status !== 'running') throw new Error('Workspace agent is not running')
    return getWorkspaceAddress(workspaceId)
  }

  server.registerTool(
    'skill_create_draft',
    {
      title: 'Create Skill Draft',
      description: `Create a new skill draft in the workspace. This creates a skill directory with a template SKILL.md and enters editing mode.
After creating, use your file tools to write the skill content (SKILL.md and any script files) in the workspace skills directory.
When done, use skill_publish to publish the skill to the library.`,
      inputSchema: z.object({
        name: z.string().describe('Skill name (used as directory name, e.g. "my-skill")'),
      }),
    },
    async ({ name }) => {
      try {
        const address = await getAgentAddress()
        const resp = await fetch(`${address}/skills`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}))
          throw new Error((err as any).error || `Failed to create draft: ${resp.status}`)
        }
        const data = (await resp.json()) as { success: boolean; name: string; path?: string }
        return textResult(
          JSON.stringify({
            success: true,
            name,
            path: data.path,
            message: `Skill draft "${name}" created at ${data.path || 'the skills directory'}. Edit files there, then use skill_publish to publish.`,
          }),
        )
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'skill_enter_edit',
    {
      title: 'Enter Skill Edit Mode',
      description: `Enter editing mode for an existing skill. This creates a lock file that prevents the skill from being overwritten during reload.
You must enter edit mode before modifying skill files. Use skill_publish when done.`,
      inputSchema: z.object({
        name: z.string().describe('Name of the skill to edit'),
      }),
    },
    async ({ name }) => {
      try {
        const address = await getAgentAddress()
        const resp = await fetch(`${address}/skills/${encodeURIComponent(name)}/edit`, {
          method: 'POST',
        })
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}))
          throw new Error((err as any).error || `Failed to enter edit mode: ${resp.status}`)
        }
        return textResult(
          JSON.stringify({
            success: true,
            name,
            message: `Entered edit mode for "${name}". Modify files, then use skill_publish when done.`,
          }),
        )
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )

  server.registerTool(
    'skill_publish',
    {
      title: 'Publish Skill',
      description: `Publish a skill to the library. This packs the skill directory into a package, uploads it, enables it for the workspace, and exits editing mode.
Use this after you've finished creating or editing a skill's files.`,
      inputSchema: z.object({
        name: z.string().describe('Name of the skill to publish'),
      }),
    },
    async ({ name }) => {
      try {
        const address = await getAgentAddress()

        const ws = await getWorkspace(workspaceId)
        if (!ws) throw new Error('Workspace not found')
        // Look across owned + editor-granted skills so re-publishing a
        // skill shared with this user updates the shared row instead of
        // creating a parallel owned copy. `getWritableSkillByName` prefers
        // owned on name collisions and excludes viewer-only grants.
        const existing = await skillRepo.getWritableSkillByName(name, ws.user_id)
        if (existing) {
          const source = await skillRepo.getSource(existing.source_id)
          if (!source || source.kind !== 'native') {
            throw new Error(
              `Skill "${name}" is backed by a git source; sync the source instead of re-publishing.`,
            )
          }
        }

        const packResp = await fetch(`${address}/skills/${encodeURIComponent(name)}/pack`, {
          method: 'POST',
        })
        if (!packResp.ok) {
          const err = await packResp.json().catch(() => ({}))
          throw new Error(`Failed to pack skill: ${(err as any).error || packResp.status}`)
        }
        if (!packResp.body) throw new Error('Agent pack returned empty body')
        const contentLength = Number(packResp.headers.get('content-length') || 0) || undefined
        const body = packResp.body as unknown as ReadableStream<Uint8Array>

        let skillId: string
        if (existing) {
          // Re-publish: save draft on the existing native source, then
          // publish via the native publish endpoint — preserves version
          // history semantics (note + published_by attribution).
          await skillsService.saveDraft({
            userId: ws.user_id,
            sourceId: existing.source_id,
            body,
            contentLength,
          })
          const published = await skillsService.publishDraft(ws.user_id, existing.id)
          skillId = published.skill.id
        } else {
          // First publish for this (user, name): one-shot upload creates
          // source + skill + initial version atomically in scs.
          const uploaded = await skillsService.uploadSkill({
            userId: ws.user_id,
            name,
            description: '',
            visibility: 'private',
            body,
            contentLength,
          })
          skillId = uploaded.skill.id
        }

        const current = await skillRepo.getWorkspaceSkillIds(workspaceId)
        if (!current.includes(skillId)) {
          await skillRepo.setWorkspaceSkills(workspaceId, [...current, skillId])
        }

        await fetch(`${address}/skills/${encodeURIComponent(name)}/stop-edit`, { method: 'POST' })

        return textResult(
          JSON.stringify({
            success: true,
            name,
            message: `Skill "${name}" published and enabled for this workspace.`,
          }),
        )
      } catch (e: any) {
        return textResult(`Error: ${e.message}`)
      }
    },
  )
}
