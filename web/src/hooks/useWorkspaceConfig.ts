import { api } from '@/lib/api/client'
import type { ApiWorkspaceConfig } from '@/lib/api/types'
import { i18n } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const configKey = (id: string) => ['workspaceConfig', id] as const

export function useWorkspaceConfig(workspaceId: string) {
  const queryClient = useQueryClient()

  const {
    data: config = null,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: configKey(workspaceId),
    queryFn: () => api.getWorkspaceConfig(workspaceId),
    enabled: !!workspaceId,
  })

  const { mutateAsync } = useMutation({
    mutationFn: (patch: Partial<ApiWorkspaceConfig>) =>
      api.updateWorkspaceConfig(workspaceId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configKey(workspaceId) })
    },
  })

  const updateFields = async (patch: Partial<ApiWorkspaceConfig>) => {
    await mutateAsync(patch)
  }

  const reload = () => queryClient.invalidateQueries({ queryKey: configKey(workspaceId) })

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : i18n.t('workspace.config.errors.loadFailed')
    : null

  return { config, isLoading, error, updateFields, reload }
}
