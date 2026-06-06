/**
 * Memory plugin — placeholder registration so external plugins can fan
 * `memory.invalidate` events through the host bus and the panel can react
 * via react-query invalidation.
 */

import type { WorkspacePlugin } from '@/plugins/types'

export const memoryPlugin: WorkspacePlugin = {
  id: 'memory',
}
