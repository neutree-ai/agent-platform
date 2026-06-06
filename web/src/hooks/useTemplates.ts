import { api } from '@/lib/api/client'
import type { ApiTemplate } from '@/lib/api/types'
import { useQuery } from '@tanstack/react-query'

export const templatesQueryKey = ['templates'] as const

export function useTemplates() {
  const query = useQuery<ApiTemplate[]>({
    queryKey: templatesQueryKey,
    queryFn: () => api.listTemplates(),
  })
  return { templates: query.data ?? [], isLoading: query.isLoading }
}
