import { api } from '@/lib/api/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

/**
 * Skill exports — capability URLs for installing a skill into a local agent.
 *
 * Owner-only, and keyed per skill. Unlike the skills list these are never
 * prefetched: the query is enabled only while the export dialog is open, so
 * we don't scatter live credentials through the cache for every skill the
 * user merely looked at.
 */
const skillExportsQueryKey = (skillId: string) => ['skill-exports', skillId] as const

export function useSkillExports(skillId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: skillExportsQueryKey(skillId ?? ''),
    queryFn: () => api.listSkillExports(skillId as string),
    enabled: enabled && !!skillId,
    // Expiry is server-evaluated, so a stale list can show a link that has
    // since lapsed. Short window keeps the management view honest.
    staleTime: 10_000,
  })
}

export function useCreateSkillExport(skillId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { slug?: string; ttl_days?: number | null; label?: string }) =>
      api.createSkillExport(skillId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillExportsQueryKey(skillId) })
    },
  })
}

export function useRevokeSkillExport(skillId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => api.revokeSkillExport(skillId, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillExportsQueryKey(skillId) })
    },
  })
}
