import { api } from '@/lib/api/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => api.listTags(),
    staleTime: 30_000,
  })
}

export function useCreateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; color?: string }) => api.createTag(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
  })
}

export function useUpdateTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; color?: string }) =>
      api.updateTag(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
  })
}

export function useDeleteTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}

export function useSetWorkspaceTags() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ workspaceId, tagIds }: { workspaceId: string; tagIds: string[] }) =>
      api.setWorkspaceTags(workspaceId, tagIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}
