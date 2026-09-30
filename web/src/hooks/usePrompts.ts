import { api } from '@/lib/api/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export const promptsQueryKey = ['prompts'] as const
export const myPromptsQueryKey = ['prompts', 'mine'] as const
const publicPromptsQueryKey = ['prompts', 'public'] as const

/**
 * Prompts visible to the user. With `workspaceId`, those visible to that
 * workspace's owner instead — the candidates for attaching to it, which differ
 * from the user's own when the workspace is shared with them.
 */
export function usePrompts(workspaceId?: string) {
  const query = useQuery({
    queryKey: workspaceId ? [...myPromptsQueryKey, { workspaceId }] : myPromptsQueryKey,
    queryFn: () => api.listPrompts(workspaceId),
  })
  return { prompts: query.data ?? [], isLoading: query.isLoading }
}

export function usePublicPrompts() {
  const query = useQuery({
    queryKey: publicPromptsQueryKey,
    queryFn: () => api.listPublicPrompts(),
  })
  return { prompts: query.data ?? [], isLoading: query.isLoading }
}

export function usePromptVersions(promptId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['prompts', 'versions', promptId],
    queryFn: () => api.listPromptVersions(promptId as string),
    enabled: !!promptId && enabled,
  })
}

export function useCreatePrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof api.createPrompt>[0]) => api.createPrompt(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: promptsQueryKey })
    },
  })
}

export function useUpdatePrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; data: Parameters<typeof api.updatePrompt>[1] }) =>
      api.updatePrompt(vars.id, vars.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: promptsQueryKey })
    },
  })
}

export function useDeletePrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deletePrompt(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: promptsQueryKey })
    },
  })
}

export function useSetDefaultPrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (promptId: string | null) => api.setDefaultPrompt(promptId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: promptsQueryKey })
    },
  })
}

export function useRollbackPrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; version: number }) =>
      api.rollbackPrompt(vars.id, vars.version),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: promptsQueryKey })
      qc.invalidateQueries({ queryKey: ['prompts', 'versions', vars.id] })
    },
  })
}
