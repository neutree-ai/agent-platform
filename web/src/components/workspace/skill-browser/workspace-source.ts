/**
 * SkillBrowserSource adapter for the workspace authoring surface.
 *
 * Reads/writes go through the workspace's dufs (`agent-files`), scoped to
 * `<skillsBasePath>/<skillName>` inside the container. Every write side-effects
 * the `.editing` lockfile via `markEditing` — the agent watches that flag to
 * suppress reload-overwrites while the user is authoring.
 *
 * The factory takes a QueryClient so `onAfterMutate` can drop the workspace's
 * private caches (enabled-skills list) without the shell needing to know
 * those queries exist.
 */
import { dirListUrl, fileUrl, mkdir as mkdirAgent, move as moveAgent } from '@/lib/api/agent-files'
import type { QueryClient } from '@tanstack/react-query'
import type { DufsEntry, SkillBrowserSource } from './types'

export interface WorkspaceSkillEntry {
  name: string
  editing: boolean
  editable: boolean
  gitSource: boolean
}

interface SkillsListResponse {
  skills: WorkspaceSkillEntry[]
  filesBrowsePath?: string
}

interface DirListResponse {
  entries: DufsEntry[]
}

const DEFAULT_SKILLS_BASE_PATH = '/.claude/skills'

function skillsApiUrl(workspaceId: string) {
  return `/_proxy/agent/${workspaceId}/skills`
}

function workspaceSkillsUrl(workspaceId: string) {
  return `/_cp/workspaces/${workspaceId}/skills`
}

export const enabledSkillsQueryKey = (workspaceId: string) =>
  ['workspace-enabled-skills', workspaceId] as const

/**
 * `basePathRef` is mutated as a side effect of `fetchSkills` so subsequent
 * fs calls know the prefix the agent reported. The agent has the option to
 * relocate the skills dir (`filesBrowsePath` response field); we default to
 * `/.claude/skills` until proven otherwise.
 */
interface WorkspaceSourceState {
  basePath: string
}

interface WorkspaceSkillSource extends SkillBrowserSource<WorkspaceSkillEntry> {
  /**
   * After a fetchSkills response lands, this returns the path prefix the
   * agent reported. The shell doesn't need it; the wrapper occasionally
   * does (publish errors, drag-target text).
   */
  getBasePath: () => string
  /**
   * Refresh the `.editing` lockfile for `skillName`. Called by `writes` after
   * every mutation; also surfaced here so the wrapper can chain it onto
   * FileViewer's save path (the file PUT happens inside FileViewer, not via
   * `writes`, so the shell doesn't see it).
   */
  markEditing: (skillName: string) => Promise<void>
}

export function createWorkspaceSkillSource(opts: {
  workspaceId: string
  queryClient: QueryClient
}): WorkspaceSkillSource {
  const { workspaceId, queryClient } = opts
  const state: WorkspaceSourceState = { basePath: DEFAULT_SKILLS_BASE_PATH }

  const skillAbsPath = (skillName: string, entryPath = '') =>
    `${state.basePath}/${skillName}${entryPath}`

  const markEditing = async (skillName: string) => {
    try {
      await fetch(`${skillsApiUrl(workspaceId)}/${skillName}/edit`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // Best-effort; failure to set the lockfile is not user-blocking.
    }
  }

  return {
    cacheNamespace: ['skill-browser-workspace', workspaceId] as const,

    async fetchSkills() {
      const resp = await fetch(skillsApiUrl(workspaceId), { credentials: 'include' })
      if (!resp.ok) throw new Error(`fetch skills failed: ${resp.status}`)
      const data = (await resp.json()) as SkillsListResponse
      state.basePath = data.filesBrowsePath ?? DEFAULT_SKILLS_BASE_PATH
      // Dot-prefixed entries are internal lockfiles / staging; never surface them.
      return (data.skills ?? []).filter((s) => !s.name.startsWith('.'))
    },

    async fetchDir(skillName, subPath) {
      const path = skillAbsPath(skillName, subPath)
      const resp = await fetch(dirListUrl(workspaceId, path), { credentials: 'include' })
      if (!resp.ok) {
        // Throw rather than returning [] — react-query needs an error to
        // trigger retry/backoff. Caching [] as success made the panel stick
        // on "empty directory" when the container wasn't ready on first
        // mount.
        throw new Error(`dir list failed: ${resp.status}`)
      }
      const data = (await resp.json()) as DirListResponse
      return (data.entries ?? []).filter((e) => e.name !== '.editing')
    },

    fileLocator(skillName, entryPath) {
      return skillAbsPath(skillName, entryPath)
    },

    writes: {
      async createFile(skillName, parentPath, name) {
        const entryPath = `${parentPath}/${name}`
        const resp = await fetch(fileUrl(workspaceId, skillAbsPath(skillName, entryPath)), {
          method: 'PUT',
          credentials: 'include',
          body: '',
        })
        if (!resp.ok) throw new Error(`Failed to create file: ${resp.status}`)
        await markEditing(skillName)
        return { entryPath }
      },

      async deleteEntry(skillName, entryPath, isDir) {
        const absolute = isDir
          ? // dufs requires the trailing slash to identify a dir DELETE
            `${skillAbsPath(skillName, entryPath)}/`
          : skillAbsPath(skillName, entryPath)
        await fetch(fileUrl(workspaceId, absolute), {
          method: 'DELETE',
          credentials: 'include',
        })
        await markEditing(skillName)
      },

      async mkdir(skillName, parentPath, name) {
        const dirPath = `${parentPath}/${name}`
        const resp = await mkdirAgent(workspaceId, skillAbsPath(skillName, dirPath))
        if (!resp.ok) throw new Error(`Create folder failed: ${resp.status}`)
        await markEditing(skillName)
      },

      async move(skillName, fromEntryPath, toEntryPath) {
        const resp = await moveAgent(
          workspaceId,
          skillAbsPath(skillName, fromEntryPath),
          skillAbsPath(skillName, toEntryPath),
        )
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}))
          throw new Error(err.error || `Move failed: ${resp.status}`)
        }
        await markEditing(skillName)
      },

      async onAfterMutate() {
        // Workspace-private side cache the shell doesn't see — keep it
        // consistent so callers of fetchEnabledSkills (publish, remove)
        // observe the post-write reality.
        await queryClient.invalidateQueries({ queryKey: enabledSkillsQueryKey(workspaceId) })
      },
    },

    getBasePath: () => state.basePath,
    markEditing,
  }
}

/**
 * Helper for the wrapper-level skill list / enabled-skills / publish ops
 * that still need to reach the agent and CP directly. Exposed so wrapper
 * code doesn't have to rebuild URL strings.
 */
export const workspaceSkillUrls = {
  skillsApi: skillsApiUrl,
  workspaceSkills: workspaceSkillsUrl,
}
