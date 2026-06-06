import { api } from '@/lib/api/client'
import type { AgentCapabilities } from '@/lib/api/types'
import { useQuery } from '@tanstack/react-query'

const ALL_TRUE: AgentCapabilities = {
  system_prompt: true,
  mcp: true,
  skills: true,
  questions: true,
  reconnect: true,
  permissions: true,
  streaming_deltas: true,
}

export function useAgentInfo(workspaceId: string | undefined) {
  const { data: agentInfo = null } = useQuery({
    queryKey: ['agentInfo', workspaceId],
    queryFn: () => api.getAgentInfo(workspaceId!),
    enabled: !!workspaceId,
  })

  const capabilities: AgentCapabilities = agentInfo?.capabilities ?? ALL_TRUE

  return { agentInfo, capabilities }
}
