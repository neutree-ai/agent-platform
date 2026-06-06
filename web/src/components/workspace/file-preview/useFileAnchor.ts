import { useInstancePersistentState } from '@/stores/instance-state-store'
import { useCallback } from 'react'

/**
 * Persistent (line, column) jump target a Files / FileViewer instance scrolls
 * to on next mount. Seeded by `WorkspaceFileLink` when the markdown anchor
 * carries `:line[:col]`; consumers clear it on user-initiated navigation so
 * one click's anchor doesn't bleed onto the next file.
 */
export function useFileAnchor(instanceId: string) {
  const [viewingLine, setViewingLine] = useInstancePersistentState<number | undefined>(
    instanceId,
    'viewingLine',
    () => undefined,
  )
  const [viewingColumn, setViewingColumn] = useInstancePersistentState<number | undefined>(
    instanceId,
    'viewingColumn',
    () => undefined,
  )
  const clearAnchor = useCallback(() => {
    setViewingLine(undefined)
    setViewingColumn(undefined)
  }, [setViewingLine, setViewingColumn])
  return { viewingLine, viewingColumn, clearAnchor }
}
