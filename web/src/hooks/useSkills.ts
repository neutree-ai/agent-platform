import { api } from '@/lib/api/client'
import type { ApiSkill, SkillVisibility } from '@/lib/api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

/**
 * Base query key — passing it WITHOUT filter arguments to
 * `invalidateQueries` invalidates every filter variant in the cache
 * (react-query treats the base key as a prefix). Mutation handlers below
 * rely on that so a write doesn't have to know which filter UI is mounted.
 */
const skillsQueryKey = ['skills'] as const
const skillSourcesQueryKey = ['skill-sources'] as const

interface SkillsListFilters {
  q?: string
  /** OR-composed list; include sentinel `"uncategorized"` for category IS NULL. */
  categories?: string[]
  visibility?: SkillVisibility
}

export function useSkills(filters: SkillsListFilters = {}) {
  // Normalize filters so the cache key is stable across no-op variations
  // (whitespace-only `q`, undefined vs empty array, etc).
  const q = filters.q?.trim() || undefined
  const categories =
    filters.categories && filters.categories.length > 0 ? [...filters.categories].sort() : undefined
  const visibility = filters.visibility
  return useQuery({
    queryKey: [...skillsQueryKey, { q, categories, visibility }],
    queryFn: () => api.listSkills({ q, categories, visibility }),
    staleTime: 30_000,
  })
}

export function useImportSkillFromGit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof api.importSkillFromGit>[0]) =>
      api.importSkillFromGit(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillsQueryKey })
      queryClient.invalidateQueries({ queryKey: skillSourcesQueryKey })
    },
  })
}

/**
 * Switch a native skill to a git source in place. Keeps the skill UUID (mounts
 * survive) but wipes native version history — callers MUST confirm with the
 * user first. Invalidates both caches since the source row flips native→git.
 */
export function useSwitchSkillToGit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { id: string; body: Parameters<typeof api.switchSkillToGit>[1] }) =>
      api.switchSkillToGit(data.id, data.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillsQueryKey })
      queryClient.invalidateQueries({ queryKey: skillSourcesQueryKey })
    },
  })
}

/**
 * Sync a git source. p3 collapsed per-skill sync into a source-level call,
 * so the input is a `sourceId`, not a skill name. Callers that have a skill
 * (e.g. a "sync this skill" button) should look up `skill.source_id` first.
 */
export function useSyncSkillSource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sourceId: string) => api.syncSkillSource(sourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillsQueryKey })
      queryClient.invalidateQueries({ queryKey: skillSourcesQueryKey })
    },
  })
}

export function useDeleteSkill() {
  const queryClient = useQueryClient()
  type SkillsCache = ApiSkill[]
  type SourcesCache = Awaited<ReturnType<typeof api.listSkillSources>>
  return useMutation({
    mutationFn: (id: string) => api.deleteSkill(id),
    onMutate: async (id) => {
      // Pause any in-flight refetches on both caches so they can't land
      // mid-mutation and resurrect the row we just removed optimistically.
      await Promise.all([
        queryClient.cancelQueries({ queryKey: skillsQueryKey }),
        queryClient.cancelQueries({ queryKey: skillSourcesQueryKey }),
      ])
      const prevSkills = queryClient.getQueriesData<SkillsCache>({ queryKey: skillsQueryKey })
      const prevSources = queryClient.getQueriesData<SourcesCache>({
        queryKey: skillSourcesQueryKey,
      })
      // Optimistic: remove from the skill list AND decrement the owning
      // source's skill_count so the Library grouping doesn't briefly drop
      // the (now last-skill-gone) source group only to re-add it as an
      // orphan once the sources cache refetches.
      const deleted = prevSkills.flatMap(([, cache]) => cache ?? []).find((s) => s.id === id)
      queryClient.setQueriesData<SkillsCache>({ queryKey: skillsQueryKey }, (old) =>
        old?.filter((s) => s.id !== id),
      )
      if (deleted) {
        queryClient.setQueriesData<SourcesCache>({ queryKey: skillSourcesQueryKey }, (old) =>
          old?.map((src) =>
            src.id === deleted.source_id
              ? { ...src, skill_count: Math.max(0, src.skill_count - 1) }
              : src,
          ),
        )
      }
      return { prevSkills, prevSources }
    },
    onError: (_err, _id, context) => {
      if (context?.prevSkills) {
        for (const [key, value] of context.prevSkills) queryClient.setQueryData(key, value)
      }
      if (context?.prevSources) {
        for (const [key, value] of context.prevSources) queryClient.setQueryData(key, value)
      }
      // Restore truth from the server after a rollback — the optimistic
      // patch was wrong.
      queryClient.invalidateQueries({ queryKey: skillsQueryKey })
      queryClient.invalidateQueries({ queryKey: skillSourcesQueryKey })
    },
    // Optimistic state already matches the server on success — no
    // refetches needed. Skipping invalidate avoids any post-refetch
    // flash between optimistic and server-confirmed renders.
  })
}

/**
 * Owner-only occupancy preview for the delete / visibility-narrow flows.
 * `enabled` lets callers fetch lazily (e.g. only when a confirm dialog opens).
 */
export function useSkillDependents(skillId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['skill-dependents', skillId],
    queryFn: () => api.getSkillDependents(skillId as string),
    enabled: !!skillId && enabled,
    staleTime: 10_000,
  })
}

export function useUploadSkill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      name: string
      description: string
      buffer: ArrayBuffer
      visibility: SkillVisibility
    }) => api.uploadSkill(data.name, data.description, data.buffer, data.visibility),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillsQueryKey })
      queryClient.invalidateQueries({ queryKey: skillSourcesQueryKey })
    },
  })
}

export function useUpdateSkillMeta() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { id: string; meta: Parameters<typeof api.updateSkillMeta>[1] }) =>
      api.updateSkillMeta(data.id, data.meta),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillsQueryKey })
    },
  })
}

// Library Skills tab grouping + per-source actions consume these. Version
// hooks stay undeclared until the version-timeline page lands.

export function useSkillSources() {
  return useQuery({
    queryKey: skillSourcesQueryKey,
    queryFn: () => api.listSkillSources(),
    staleTime: 30_000,
  })
}

export function useUpdateSkillSource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { id: string; patch: Parameters<typeof api.updateSkillSource>[1] }) =>
      api.updateSkillSource(data.id, data.patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillSourcesQueryKey })
    },
  })
}

export function useSkillVersions(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ['skill-versions', skillId],
    queryFn: () => api.listSkillVersions(skillId as string),
    enabled: !!skillId,
    staleTime: 30_000,
  })
}

/**
 * Flip a skill's active_version_id. Optimistically patches every cached
 * skills list so the dot/badge on the row updates without a refetch flash;
 * also pokes the skill-detail-dir / file caches so the active-version
 * content viewer rebinds to the newly-selected tarball.
 */
export function useSetSkillActiveVersion() {
  const queryClient = useQueryClient()
  type SkillsCache = ApiSkill[]
  return useMutation({
    mutationFn: (data: { skillId: string; versionId: string }) =>
      api.setSkillActiveVersion(data.skillId, data.versionId),
    onMutate: async ({ skillId, versionId }) => {
      await queryClient.cancelQueries({ queryKey: skillsQueryKey })
      const prev = queryClient.getQueriesData<SkillsCache>({ queryKey: skillsQueryKey })
      queryClient.setQueriesData<SkillsCache>({ queryKey: skillsQueryKey }, (old) =>
        old?.map((s) => (s.id === skillId ? { ...s, active_version_id: versionId } : s)),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) for (const [k, v] of ctx.prev) queryClient.setQueryData(k, v)
      queryClient.invalidateQueries({ queryKey: skillsQueryKey })
    },
    onSuccess: (_data, { skillId }) => {
      // Re-fetch the version list (active flips) and clear active-version
      // content caches — the tar pointed at the previous version's content.
      queryClient.invalidateQueries({ queryKey: ['skill-versions', skillId] })
      queryClient.invalidateQueries({ queryKey: ['skill-detail-dir', skillId] })
      queryClient.invalidateQueries({ queryKey: ['skill-detail-file', skillId] })
    },
  })
}

export function useDeleteSkillSource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteSkillSource(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillsQueryKey })
      queryClient.invalidateQueries({ queryKey: skillSourcesQueryKey })
    },
  })
}
