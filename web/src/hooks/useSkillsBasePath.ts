import { DEFAULT_SKILLS_BASE_PATH } from '@/lib/workspace-file-link'
import { useQuery } from '@tanstack/react-query'

const skillsBasePathQueryKey = (workspaceId: string) => ['skills-base-path', workspaceId] as const

/**
 * Resolve the workspace-relative skills root the agent reports as
 * `filesBrowsePath` — `/.claude/skills` (claude-code) or `/.home/.codex/skills`
 * (codex). Used to rewrite agent-emitted `/tmp/skill-<name>` links onto the
 * right workspace-drive path so they resolve in the file viewer.
 *
 * `enabled` gates the fetch so unrelated markdown (the overwhelming majority,
 * with no skill `/tmp` link) never pokes the agent skills endpoint. The value
 * is stable for the life of a workspace, so it's cached indefinitely. Falls
 * back to the claude-code layout until the value lands (or if the fetch fails).
 */
export function useSkillsBasePath(workspaceId: string | undefined, enabled: boolean): string {
  const { data } = useQuery({
    queryKey: skillsBasePathQueryKey(workspaceId ?? ''),
    queryFn: async () => {
      // Canonical agent skills endpoint (same as the skill browser uses).
      const resp = await fetch(`/_proxy/agent/${workspaceId}/skills`, { credentials: 'include' })
      if (!resp.ok) throw new Error(`fetch skills failed: ${resp.status}`)
      const json = (await resp.json()) as { filesBrowsePath?: string }
      return json.filesBrowsePath ?? DEFAULT_SKILLS_BASE_PATH
    },
    enabled: enabled && !!workspaceId,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  })
  return data ?? DEFAULT_SKILLS_BASE_PATH
}
