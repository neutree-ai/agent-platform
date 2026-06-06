import { api } from '@/lib/api/client'
import { i18n } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export function useBrowsers(workspaceId: string) {
  return useQuery({
    queryKey: ['browsers', workspaceId],
    queryFn: () => api.listWorkspaceBrowsers(workspaceId),
    refetchInterval: 10_000,
  })
}

export function useCreateBrowser(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data?: { timeout_seconds?: number }) =>
      api.createWorkspaceBrowser(workspaceId, data),
    onSuccess: (newBrowser) => {
      // Immediately append to cache so UI switches to browser view without waiting for refetch
      queryClient.setQueryData(['browsers', workspaceId], (old: any) => ({
        ...old,
        items: [...(old?.items ?? []), newBrowser],
      }))
      queryClient.invalidateQueries({ queryKey: ['browsers', workspaceId] })
    },
    onError: (err: Error) => {
      toast.error(err.message || i18n.t('workspace.browser.errors.createFailed'))
    },
  })
}

export function useRenewBrowser(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ browserId, timeoutSeconds }: { browserId: string; timeoutSeconds?: number }) =>
      api.renewWorkspaceBrowser(workspaceId, browserId, timeoutSeconds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['browsers', workspaceId] })
    },
    onError: (err: Error) => {
      toast.error(err.message || i18n.t('workspace.browser.errors.renewFailed'))
    },
  })
}

export function useDeleteBrowser(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (browserId: string) => api.deleteWorkspaceBrowser(workspaceId, browserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['browsers', workspaceId] })
    },
    onError: (err: Error) => {
      toast.error(err.message || i18n.t('workspace.browser.errors.deleteFailed'))
    },
  })
}
