import { api } from '@/lib/api/client'
import { i18n } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export function useWorkspaces(opts?: { search?: string }) {
  return useQuery({
    queryKey: ['workspaces', opts?.search],
    queryFn: () => api.getWorkspaces({ search: opts?.search }),
    refetchInterval: 15_000,
  })
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof api.createWorkspace>[0]) => api.createWorkspace(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}

export function usePatchWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: { id: string; name?: string; slug?: string | null; visibility?: string }) =>
      api.patchWorkspace(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })
}

export function useStartWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.startWorkspace(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })
}

export function useStopWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.stopWorkspace(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })
}

export function useRestartWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      await api.stopWorkspace(id)
      return api.startWorkspace(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })
}

/**
 * Rebuilds the workspace's runtime when it drifts from the current platform
 * template (relaxed probes, new sidecars, image). Disruptive — the pod is
 * replaced. No-op server-side when already in sync.
 */
export function useRebuildWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.rebuildWorkspace(id),
    onSuccess: (_res, id) => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      queryClient.invalidateQueries({ queryKey: ['workspace-status', id] })
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })
}

/**
 * Polls the K8s status endpoint while a workspace is in a transient state
 * (e.g. `starting`). Surfaces pod warnings like FailedScheduling so users
 * see *why* a start is hanging instead of an indefinite spinner.
 */
export function useWorkspaceStatus(id: string, opts: { enabled: boolean }) {
  return useQuery({
    queryKey: ['workspace-status', id],
    queryFn: () => api.getWorkspaceStatus(id),
    enabled: opts.enabled,
    refetchInterval: opts.enabled ? 8_000 : false,
    retry: false,
  })
}

export function useDeleteWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.deleteWorkspace(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : i18n.t('workspace.errors.deleteFailed'))
    },
  })
}
