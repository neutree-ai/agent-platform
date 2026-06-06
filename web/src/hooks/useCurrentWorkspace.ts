import { useWorkspaces } from '@/hooks/useWorkspaces'
import { useMemo } from 'react'
import { useParams } from 'react-router-dom'

/**
 * Resolves the current workspace from the URL. Returns undefined when the
 * route has no :workspaceId or the workspace list hasn't loaded yet.
 */
export function useCurrentWorkspace() {
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  const { data: workspaces } = useWorkspaces()
  return useMemo(() => workspaces?.find((w) => w.id === workspaceId), [workspaces, workspaceId])
}
