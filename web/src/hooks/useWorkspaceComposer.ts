import { commandsQueryOptions } from '@/hooks/useCommands'
import { api } from '@/lib/api/client'
import {
  type NapComposerClient,
  type NapComposerPreset,
  createNapHttpClient,
  useNapComposer,
} from '@neutree-ai/ui-sdk'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

/**
 * Composer data sources for a workspace chat: built-in and workspace slash
 * commands, `@file/…`, `@agent/…` and voice. Commands and callable agents go
 * through the shared query cache (the command editors invalidate
 * `['commands', id]`), serving cached data at once and revalidating behind it.
 */
export function useWorkspaceComposer(workspaceId: string, agentType: string): NapComposerPreset {
  const queryClient = useQueryClient()
  const client = useMemo<NapComposerClient>(() => {
    const http = createNapHttpClient({ baseUrl: '/api', workspaceId, credentials: 'include' })
    return {
      listCommands: () =>
        queryClient.ensureQueryData({
          ...commandsQueryOptions(workspaceId),
          revalidateIfStale: true,
        }),
      listCallableAgents: () =>
        queryClient.ensureQueryData({
          queryKey: ['callable-agents'],
          queryFn: () => api.getCallableAgents(),
          revalidateIfStale: true,
        }),
      listDir: http.listDir,
      transcribe: http.transcribe,
    }
  }, [queryClient, workspaceId])

  return useNapComposer({ client, agentType, workspaceId, voice: { shortcut: true } })
}
