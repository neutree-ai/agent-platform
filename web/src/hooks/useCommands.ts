import { api } from '@/lib/api/client'
import type { WorkspaceCommand } from '@/lib/api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export function useCommands(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: ['commands', workspaceId],
    queryFn: () => api.listCommands(workspaceId),
    enabled,
  })
}

export function useCreateCommand(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      name: string
      type: 'plain' | 'struct'
      prompt_id?: string | null
      content?: string
      sort_order?: number
    }) => api.createCommand(workspaceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commands', workspaceId] })
    },
  })
}

export function useUpdateCommand(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: { id: string } & Partial<
      Pick<WorkspaceCommand, 'name' | 'type' | 'prompt_id' | 'content' | 'sort_order' | 'disabled'>
    >) => api.updateCommand(workspaceId, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commands', workspaceId] })
    },
  })
}

export function useDeleteCommand(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteCommand(workspaceId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commands', workspaceId] })
    },
  })
}

/** Enable/disable a template-provided command (keyed by name). */
export function useSetCommandDisabled(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, disabled }: { name: string; disabled: boolean }) =>
      api.setCommandDisabled(workspaceId, name, disabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commands', workspaceId] })
    },
  })
}
