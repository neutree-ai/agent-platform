import { cgApi } from '@/lib/api/channel-gateway'
import { useQuery } from '@tanstack/react-query'

export function useSessionSource(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['sessionSource', sessionId],
    queryFn: () => cgApi.getSessionSource(sessionId!),
    enabled: !!sessionId,
  })
}
