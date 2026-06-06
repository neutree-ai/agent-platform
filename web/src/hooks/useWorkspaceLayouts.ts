import { api } from '@/lib/api/client'
import type { ApiWorkspaceLayout, LayoutSkeleton } from '@/lib/api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export const workspaceLayoutsQueryKey = ['workspace-layouts'] as const

/** The current user's saved layouts (custom + template-origin copies). */
export function useWorkspaceLayouts() {
  const query = useQuery<ApiWorkspaceLayout[]>({
    queryKey: workspaceLayoutsQueryKey,
    queryFn: () => api.listWorkspaceLayouts(),
  })
  return { layouts: query.data ?? [], isLoading: query.isLoading }
}

export function useUpdateWorkspaceLayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: Partial<{ name: string; description: string; skeleton: LayoutSkeleton }>
    }) => api.updateWorkspaceLayout(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: workspaceLayoutsQueryKey }),
  })
}

export function useDeleteWorkspaceLayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteWorkspaceLayout(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: workspaceLayoutsQueryKey }),
  })
}
