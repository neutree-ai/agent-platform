import { api } from '@/lib/api/client'
import { i18n } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export function useSandboxes(workspaceId: string) {
  return useQuery({
    queryKey: ['sandboxes', workspaceId],
    queryFn: () => api.listWorkspaceSandboxes(workspaceId),
    refetchInterval: 30_000,
  })
}

export function useCreateSandbox(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      image: string
      resource?: Record<string, string>
      timeout_seconds?: number
    }) => api.createWorkspaceSandbox(workspaceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandboxes', workspaceId] })
    },
    onError: (err: Error) => {
      toast.error(err.message || i18n.t('workspace.sandbox.errors.createFailed'))
    },
  })
}

export function useDeleteSandbox(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (sandboxId: string) => api.deleteWorkspaceSandbox(workspaceId, sandboxId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandboxes', workspaceId] })
    },
    onError: (err: Error) => {
      toast.error(err.message || i18n.t('workspace.sandbox.errors.deleteFailed'))
    },
  })
}
