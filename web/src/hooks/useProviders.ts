import { api } from '@/lib/api/client'
import { i18n } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

/** Providers visible to the user; with `workspaceId`, to that workspace's owner. */
export function useProviders(workspaceId?: string) {
  return useQuery({
    queryKey: workspaceId ? ['providers', { workspaceId }] : ['providers'],
    queryFn: () => api.listProviders(workspaceId),
    staleTime: 30_000,
  })
}

export function useCreateProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof api.createProvider>[0]) => api.createProvider(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providers'] })
    },
  })
}

export function useUpdateProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Parameters<typeof api.updateProvider>[1]) =>
      api.updateProvider(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providers'] })
    },
  })
}

export function useDeleteProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteProvider(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['providers'] })
      const previous = queryClient.getQueryData<Awaited<ReturnType<typeof api.listProviders>>>([
        'providers',
      ])
      queryClient.setQueryData(['providers'], (old: typeof previous) =>
        old?.filter((p) => p.id !== id),
      )
      return { previous }
    },
    onError: (err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['providers'], context.previous)
      }
      toast.error(
        err instanceof Error
          ? err.message
          : i18n.t('components.management.providers.errors.deleteFailed'),
      )
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['providers'] })
    },
  })
}
